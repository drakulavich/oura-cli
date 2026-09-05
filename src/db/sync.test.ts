import { describe, it, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { importDaily } from './sync.js';
import type { OuraClient } from '../api/client.js';
import type { OuraEndpoint } from '../api/types.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';

const TEST_DB = join(tmpdir(), `oura-import-test-${Date.now()}.db`);
const TODAY = '2026-03-05';

afterEach(() => {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + '-wal'); } catch {}
  try { unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('Import', () => {
  describe('upsert behaviour', () => {
    it('overwrites an existing row when the same id is imported again so re-syncs stay idempotent', () => {
      const db = new Database(TEST_DB);
      db.exec('PRAGMA journal_mode = WAL');
      ensureSchema(db);

      db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)')
        .run('id1', '2026-03-05', 80, '{}', '2026-03-05T00:00:00Z');
      db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)')
        .run('id1', '2026-03-05', 85, '{}', '2026-03-05T00:00:00Z');

      const row = db.query('SELECT score FROM daily_sleep WHERE id = ?').get('id1') as { score: number };
      expect(row.score).toBe(85);

      db.close();
    });
  });

  describe('nullable upstream fields', () => {
    // The Oura spec marks daily_stress.day_summary, workout.label and sleep.type
    // as nullable; every column backing them is nullable TEXT.
    const rows: Partial<Record<OuraEndpoint, unknown[]>> = {
      daily_stress: [{ id: 's1', day: '2026-03-05', day_summary: null, recovery_high: null, stress_high: null }],
      workout: [{
        id: 'w1', day: '2026-03-05', activity: 'walking', calories: null, distance: null,
        start_datetime: '2026-03-05T10:00:00Z', end_datetime: '2026-03-05T10:30:00Z',
        intensity: 'easy', label: null, source: 'manual',
      }],
      sleep: [{
        id: 'p1', day: '2026-03-05', average_breath: null, average_heart_rate: null, average_hrv: null,
        awake_time: null, bedtime_end: '2026-03-05T07:00:00Z', bedtime_start: '2026-03-04T23:00:00Z',
        deep_sleep_duration: null, efficiency: null, latency: null, light_sleep_duration: null,
        lowest_heart_rate: null, period: null, rem_sleep_duration: null, restless_periods: null,
        time_in_bed: null, total_sleep_duration: null, type: null,
      }],
    };
    const client = {
      fetch: async <T,>(endpoint: OuraEndpoint) => (rows[endpoint] ?? []) as T[],
    } as unknown as OuraClient;

    it('stores a null day_summary, label and sleep type without failing the sync', async () => {
      const db = new Database(TEST_DB);
      ensureSchema(db);

      await importDaily(db, client, { today: TODAY, tz: 'UTC' });

      const stress = db.query('SELECT day_summary FROM daily_stress WHERE id = ?').get('s1') as { day_summary: string | null };
      expect(stress.day_summary).toBeNull();

      const sleep = db.query('SELECT type FROM sleep_model WHERE id = ?').get('p1') as { type: string | null };
      expect(sleep.type).toBeNull();

      // Workouts are the exception: import.ts coerces a null label to '' rather
      // than storing NULL. Asserted so the coercion stays a deliberate choice.
      const workout = db.query('SELECT label FROM workouts WHERE id = ?').get('w1') as { label: string | null };
      expect(workout.label).toBe('');

      db.close();
    });

    it('treats an omitted property the same as an explicit null, since the spec marks all three optional', async () => {
      const omitted: Partial<Record<OuraEndpoint, unknown[]>> = {
        daily_stress: [{ id: 's2', day: '2026-03-06', recovery_high: null, stress_high: null }],
        sleep: [{
          id: 'p2', day: '2026-03-06', average_breath: null, average_heart_rate: null, average_hrv: null,
          awake_time: null, bedtime_end: '2026-03-06T07:00:00Z', bedtime_start: '2026-03-05T23:00:00Z',
          deep_sleep_duration: null, efficiency: null, latency: null, light_sleep_duration: null,
          lowest_heart_rate: null, period: null, rem_sleep_duration: null, restless_periods: null,
          time_in_bed: null, total_sleep_duration: null,
        }],
      };
      const db = new Database(TEST_DB);
      ensureSchema(db);

      await importDaily(db, {
        fetch: async <T,>(endpoint: OuraEndpoint) => (omitted[endpoint] ?? []) as T[],
      } as unknown as OuraClient, { today: TODAY, tz: 'UTC' });

      const stress = db.query('SELECT day_summary FROM daily_stress WHERE id = ?').get('s2') as { day_summary: string | null };
      expect(stress.day_summary).toBeNull();

      const sleep = db.query('SELECT type FROM sleep_model WHERE id = ?').get('p2') as { type: string | null };
      expect(sleep.type).toBeNull();

      db.close();
    });
  });

  describe('registry-driven sync', () => {
    it('inserts every registry collection and counts rows by table name', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      const rows: Record<string, unknown[]> = {
        daily_sleep: [{ id: 's1', day: '2026-06-15', score: 80, contributors: {}, timestamp: 't' }],
        heartrate: [{ bpm: 60, source: 'awake', timestamp: '2026-06-15T10:00:00+00:00' }],
        daily_cardiovascular_age: [{ id: 'c1', day: '2026-06-15', vascular_age: 30 }],
      };
      const client = { fetch: async (endpoint: OuraEndpoint) => rows[endpoint] ?? [] } as unknown as OuraClient;
      const result = await importDaily(db, client, { today: '2026-06-15', tz: 'UTC' });
      expect(result.counts).toEqual({
        daily_sleep: 1, daily_readiness: 0, daily_activity: 0, heartrate: 1, daily_spo2: 0,
        daily_stress: 0, workouts: 0, sleep_model: 0, cardiovascular_age: 1,
      });
      expect(db.query('SELECT day FROM heartrate').get()).toEqual({ day: '2026-06-15' });
    });
  });

  describe('request parameters', () => {
    it('sends the same window to every endpoint: dates to daily ones, UTC datetimes covering the local days to heartrate', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      const client = {
        fetch: async (endpoint: OuraEndpoint, query: Record<string, string>) => { calls.push([endpoint, query]); return []; },
      } as unknown as OuraClient;

      await importDaily(db, client, { today: '2026-06-15', tz: 'Europe/Berlin' });
      db.close();

      const byEndpoint = Object.fromEntries(calls);
      expect(byEndpoint['daily_sleep']).toEqual({ start_date: '2026-05-16', end_date: '2026-06-15' });
      expect(byEndpoint['heartrate']).toEqual({ start_datetime: '2026-05-15T22:00:00Z', end_datetime: '2026-06-15T22:00:00Z' });
      expect(Object.values(byEndpoint).some(q => 'start_date' in q && 'start_datetime' in q)).toBe(false);
    });
  });
});
