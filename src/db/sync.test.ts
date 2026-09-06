import { describe, it, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { COLLECTIONS } from '../collections/index.js';
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
      // Like the real API, answer only with samples inside the requested window (heartrate is fetched in pieces).
      const client = {
        fetch: async (endpoint: OuraEndpoint, query: Record<string, string>) => (rows[endpoint] ?? []).filter(r => {
          const ts = (r as { timestamp?: string }).timestamp?.replace('+00:00', 'Z');
          return !query.start_datetime || !ts || (query.start_datetime <= ts && ts <= query.end_datetime!);
        }),
      } as unknown as OuraClient;
      const result = await importDaily(db, client, { today: '2026-06-15', tz: 'UTC' });
      expect(result.fetched).toEqual({
        daily_sleep: 1, daily_readiness: 0, daily_activity: 0, heartrate: 1, daily_spo2: 0,
        daily_stress: 0, workouts: 0, sleep_model: 0, cardiovascular_age: 1,
        daily_resilience: 0, vo2max: 0, sleep_time: 0, sessions: 0, rest_mode_periods: 0, enhanced_tags: 0,
        ring_configuration: 0, ring_battery_level: 0,
      });
      expect(result.added).toEqual(result.fetched);
      expect(db.query('SELECT day FROM heartrate').get()).toEqual({ day: '2026-06-15' });
    });
  });

  describe('request parameters', () => {
    function recordingClient(calls: Array<[OuraEndpoint, Record<string, string>]>): OuraClient {
      return {
        fetch: async (endpoint: OuraEndpoint, query: Record<string, string>) => { calls.push([endpoint, query]); return []; },
      } as unknown as OuraClient;
    }
    const queriesFor = (calls: Array<[OuraEndpoint, Record<string, string>]>, e: OuraEndpoint) =>
      calls.filter(([ep]) => ep === e).map(([, q]) => q);

    it('first sync: a 30-day inclusive window, dates to daily endpoints, one UTC-datetime piece to heartrate', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      const result = await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'Europe/Berlin' });
      db.close();

      expect(result.isFirstSync).toBe(true);
      expect(result.startDate).toBe('2026-05-17');
      expect(queriesFor(calls, 'daily_sleep')).toEqual([{ start_date: '2026-05-17', end_date: '2026-06-15' }]);
      // sleep periods: start bound exclusive → asked from the day before; workouts: end exclusive → until the day after.
      expect(queriesFor(calls, 'sleep')).toEqual([{ start_date: '2026-05-16', end_date: '2026-06-15' }]);
      expect(queriesFor(calls, 'workout')).toEqual([{ start_date: '2026-05-17', end_date: '2026-06-16' }]);
      expect(queriesFor(calls, 'heartrate')).toEqual([
        { start_datetime: '2026-05-16T22:00:00.000Z', end_datetime: '2026-06-15T21:59:59.999Z' },
      ]);
      expect(calls.some(([, q]) => 'start_date' in q && 'start_datetime' in q)).toBe(false);
      // ring_configuration is a snapshot: one request, no range parameters at all.
      expect(queriesFor(calls, 'ring_configuration')).toEqual([{}]);
    });

    it('fetches a snapshot collection whole on every run and leaves isFirstSync to the ranged ones', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO ring_configuration (id) VALUES ('ring-1')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      const result = await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      expect(result.isFirstSync).toBe(true); // every ranged table is empty; the ring row does not count
      expect(queriesFor(calls, 'ring_configuration')).toEqual([{}]);
    });

    it('replaces a snapshot table with the response: removed rings go, new ones count as new', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO ring_configuration (id) VALUES ('old-ring')").run();
      db.query("INSERT INTO ring_configuration (id) VALUES ('kept-ring')").run();
      const client = {
        fetch: async (endpoint: OuraEndpoint) => endpoint === 'ring_configuration'
          ? [{ id: 'kept-ring', color: 'silver' }, { id: 'new-ring', color: 'black' }] : [],
      } as unknown as OuraClient;

      const result = await importDaily(db, client, { today: '2026-06-15', tz: 'UTC' });
      const ids = (db.query('SELECT id FROM ring_configuration ORDER BY id').all() as { id: string }[]).map(r => r.id);
      db.close();

      expect(ids).toEqual(['kept-ring', 'new-ring']);
      expect(result.fetched.ring_configuration).toBe(2);
      expect(result.added.ring_configuration).toBe(1);
    });

    it('every collection resumes from its own last stored day, so an empty table is backfilled while others stay incremental', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO daily_sleep (id, day) VALUES ('s', '2026-06-13')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      const result = await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      expect(result.isFirstSync).toBe(false);
      expect(queriesFor(calls, 'daily_sleep')).toEqual([{ start_date: '2026-06-13', end_date: '2026-06-15' }]);
      expect(queriesFor(calls, 'daily_readiness')).toEqual([{ start_date: '2026-05-17', end_date: '2026-06-15' }]);
      expect(queriesFor(calls, 'heartrate')[0]!.start_datetime).toBe('2026-05-17T00:00:00.000Z');
      expect(result.startDate).toBe('2026-05-17'); // the earliest window across collections
    });

    it('ignores a stored day past the end of the window and resumes from the day before it', async () => {
      // #69: --tz west of the cache's zone put MAX(day) after today, the range inverted, and
      // `rangeQueries` answers an inverted range with no queries at all — a silent no-op.
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO daily_sleep (id, day) VALUES ('s', '2026-06-14')").run();
      db.query("INSERT INTO daily_sleep (id, day) VALUES ('tomorrow', '2026-06-16')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      expect(queriesFor(calls, 'daily_sleep')).toEqual([{ start_date: '2026-06-14', end_date: '2026-06-15' }]);
    });

    it('keeps fetching the days behind a tag dated in the future, which Oura allows', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO enhanced_tags (id, day) VALUES ('real', '2026-06-08')").run();
      db.query("INSERT INTO enhanced_tags (id, day) VALUES ('future', '2027-01-01')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      // Resumes from the real tag, not from the future one: the six days between must not be skipped.
      // enhanced_tag excludes end_date, hence the [0, 1] offset on the end bound.
      expect(queriesFor(calls, 'enhanced_tag')).toEqual([{ start_date: '2026-06-08', end_date: '2026-06-16' }]);
    });

    it('backfills a collection that holds nothing but future days, instead of asking for one day', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO enhanced_tags (id, day) VALUES ('future', '2027-01-01')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      expect(queriesFor(calls, 'enhanced_tag')).toEqual([{ start_date: '2026-05-17', end_date: '2026-06-16' }]);
    });

    it('re-walks the days behind the heartrate watermark, since Oura backfills workout samples late', async () => {
      // #68: an incremental sync overlapped by one day, so samples Oura added to older days
      // were never fetched — 8,004 of them over 9 days on the account this was found on.
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO heartrate (timestamp, bpm, source, day) VALUES ('2026-06-14T10:00:00+00:00', 60, 'awake', '2026-06-14')").run();
      db.query("INSERT INTO daily_sleep (id, day) VALUES ('s', '2026-06-14')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      expect(queriesFor(calls, 'heartrate')[0]!.start_datetime).toBe('2026-05-31T00:00:00.000Z'); // 14 days back
      // the daily summaries keep their one-day overlap: Oura revises those, it does not append to them.
      expect(queriesFor(calls, 'daily_sleep')).toEqual([{ start_date: '2026-06-14', end_date: '2026-06-15' }]);
    });

    it('reports the window the cache needed, not the tail heart rate re-reads', async () => {
      // Otherwise a fully populated cache would announce a fortnight on every sync, while
      // sixteen of seventeen collections asked for a single day.
      const db = new Database(':memory:');
      ensureSchema(db);
      for (const c of COLLECTIONS.filter(c => c.rangeParams !== 'none')) {
        const cols = c.columns.map(col => col.name);
        const values = cols.map(name => name === 'day' ? "'2026-06-15'" : name === 'timestamp' ? "'2026-06-15T10:00:00+00:00'" : "'x'");
        db.query(`INSERT INTO ${c.table} (${cols.join(', ')}) VALUES (${values.join(', ')})`).run();
      }
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      const result = await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' });
      db.close();

      expect(result.startDate).toBe('2026-06-15');
      expect(queriesFor(calls, 'heartrate')[0]!.start_datetime).toBe('2026-06-01T00:00:00.000Z');
    });

    it('an explicit window replaces every watermark', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      db.query("INSERT INTO daily_sleep (id, day) VALUES ('s', '2026-06-13')").run();
      const calls: Array<[OuraEndpoint, Record<string, string>]> = [];
      const result = await importDaily(db, recordingClient(calls), { today: '2026-06-15', tz: 'UTC' }, undefined, { from: '2026-06-01', to: '2026-06-03' });
      db.close();

      expect(result.startDate).toBe('2026-06-01');
      expect(result.endDate).toBe('2026-06-03');
      expect(queriesFor(calls, 'daily_sleep')).toEqual([{ start_date: '2026-06-01', end_date: '2026-06-03' }]);
      expect(queriesFor(calls, 'daily_activity')).toEqual([{ start_date: '2026-06-01', end_date: '2026-06-03' }]);
    });

    it('does not call an explicit window on an empty database a 30-day backfill', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      const lines: string[] = [];
      const result = await importDaily(db, recordingClient([]), { today: '2026-06-15', tz: 'UTC' }, m => lines.push(m), { from: '2026-06-10', to: '2026-06-12' });
      db.close();

      expect(result.isFirstSync).toBe(true);
      expect(lines[0]).toBe('Syncing 2026-06-10 → 2026-06-12');
    });

    it('counts rows that were new separately from rows fetched, so a repeat sync reports +0', async () => {
      const db = new Database(':memory:');
      ensureSchema(db);
      const rows: Partial<Record<OuraEndpoint, unknown[]>> = {
        daily_sleep: [{ id: 's1', day: '2026-06-15', score: 80, contributors: {}, timestamp: 't' }],
        heartrate: [{ bpm: 60, source: 'awake', timestamp: '2026-06-15T10:00:00Z' }],
      };
      const client = { fetch: async (endpoint: OuraEndpoint) => rows[endpoint] ?? [] } as unknown as OuraClient;

      const first = await importDaily(db, client, { today: '2026-06-15', tz: 'UTC' });
      expect(first.fetched.daily_sleep).toBe(1);
      expect(first.added.daily_sleep).toBe(1);
      expect(first.added.heartrate).toBe(1);

      const second = await importDaily(db, client, { today: '2026-06-15', tz: 'UTC' });
      expect(second.fetched.daily_sleep).toBe(1); // re-fetched and replaced
      expect(second.added.daily_sleep).toBe(0);
      expect(second.fetched.heartrate).toBe(1);   // re-fetched and ignored by the unique index
      expect(second.added.heartrate).toBe(0);
      db.close();
    });
  });
});
