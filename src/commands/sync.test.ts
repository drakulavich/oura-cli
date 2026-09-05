import { describe, it, expect, beforeEach, afterEach, setSystemTime } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { runSync } from './sync.js';
import { ensureSchema } from '../db/database.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary } from '../render/format.js';
import { OuraClient } from '../api/client.js';
import type { Ctx, Output } from './run-command.js';
import type { ImportResult } from '../db/import.js';
import type { DaySummary } from '../db/queries.js';

// Characterization tests for `runSync` (src/commands/sync.ts) — the thin
// orchestration layer that runs an API import against an already-open db and
// client, then reads back "today"'s summary. Format resolution, db opening
// and client construction are now the runner's job (src/commands/run-command.ts,
// covered by run-command.test.ts) and OuraClient's own construction concerns
// (e.g. TOKEN_MISSING) are covered by src/api/client.test.ts — so this file
// only drives `runSync` directly against a `Ctx` value, as production code
// does. Boundaries are mocked exactly where the code touches the outside
// world: HTTP via a `globalThis.fetch` stub, sqlite via a temp db file.

const realFetch = globalThis.fetch;

// The clock is frozen (via setSystemTime in beforeEach) at noon UTC on a fixed
// date, so every `new Date()` inside runSync/importDaily and every helper
// resolving "today" agrees on the same day. TODAY/YESTERDAY are therefore
// constants, not values captured at module load — this removes the UTC-midnight
// window where a load-time fixture date could diverge from a date computed
// during test execution. We drive runSync with tz='UTC' so the summarized day
// equals TODAY exactly.
const FROZEN_NOW = '2026-06-15T12:00:00.000Z';
const TODAY = '2026-06-15';
const YESTERDAY = '2026-06-14';

let TEST_DB: string;
let dbCounter = 0;

function removeDb(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch {}
  }
}

// Install a fetch stub that returns `{ data: rows }` keyed by the Oura
// endpoint (the last path segment of the request URL). Unlisted endpoints
// return an empty data array.
function installFetch(dataByEndpoint: Record<string, unknown[]>): void {
  globalThis.fetch = (async (url: unknown) => {
    const endpoint = new URL(String(url)).pathname.split('/').pop() ?? '';
    const rows = dataByEndpoint[endpoint] ?? [];
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

// A full "today" dataset covering every metric getDaySummary reads.
function todayFixture(): Record<string, unknown[]> {
  return {
    daily_sleep: [{ id: 's1', day: TODAY, score: 88, contributors: {}, timestamp: `${TODAY}T00:00:00Z` }],
    daily_readiness: [{
      id: 'r1', day: TODAY, score: 77, contributors: {},
      temperature_deviation: 0.2, temperature_trend_deviation: 0.1, timestamp: `${TODAY}T00:00:00Z`,
    }],
    daily_activity: [{
      id: 'a1', day: TODAY, score: 90, active_calories: 500, steps: 12000,
      equivalent_walking_distance: 8000, high_activity_time: 600, medium_activity_time: 1200,
      low_activity_time: 3600, sedentary_time: 40000, total_calories: 2500, target_calories: 2400,
      contributors: {}, timestamp: `${TODAY}T00:00:00Z`,
    }],
    daily_spo2: [{ id: 'o1', day: TODAY, spo2_percentage: { average: 97.5 }, breathing_disturbance_index: 3 }],
    daily_stress: [{ id: 't1', day: TODAY, day_summary: 'normal', recovery_high: 100, stress_high: 200 }],
    sleep: [{
      id: 'p1', day: TODAY, average_breath: 14, average_heart_rate: 55, average_hrv: 45,
      awake_time: 1800, bedtime_end: `${TODAY}T07:00:00Z`, bedtime_start: `${YESTERDAY}T23:00:00Z`,
      deep_sleep_duration: 7200, efficiency: 90, latency: 600, light_sleep_duration: 16200,
      lowest_heart_rate: 50, period: 0, rem_sleep_duration: 5400, restless_periods: 5,
      time_in_bed: 30600, total_sleep_duration: 28800, type: 'long_sleep',
    }],
  };
}

// Opens a fresh, schema-ready sqlite db and drives `runSync` against it with
// a `Ctx` shaped exactly as the runner (`execute` in run-command.ts) would
// build one. Returns the `Output` plus the open `Database` handle so tests
// can inspect persisted rows before closing it themselves.
async function runSyncFor(format: 'json' | 'table', dbPath = TEST_DB): Promise<{ out: Output; db: Database }> {
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  ensureSchema(db);
  const ctx: Ctx = { format, tz: 'UTC', today: TODAY, db, client: new OuraClient({ token: 'test-token' }) };
  const out = await runSync(ctx);
  return { out, db };
}

beforeEach(() => {
  setSystemTime(new Date(FROZEN_NOW));
  TEST_DB = join(tmpdir(), `oura-sync-test-${process.pid}-${dbCounter++}.db`);
});

afterEach(() => {
  setSystemTime();
  globalThis.fetch = realFetch;
  removeDb(TEST_DB);
});

describe('runSync', () => {
  describe('JSON output', () => {
    it('returns a single { import, today } object', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('json');
      db.close();

      expect(Object.keys(out.json as object).sort()).toEqual(['import', 'today']);
    });

    it('reports the import window and per-endpoint counts in the import payload', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('json');
      db.close();

      const { import: result } = out.json as { import: ImportResult; today: DaySummary };
      expect(result.endDate).toBe(TODAY);
      expect(typeof result.startDate).toBe('string');
      // One row was returned for each of these endpoints in the fixture.
      expect(result.counts.daily_sleep).toBe(1);
      expect(result.counts.daily_readiness).toBe(1);
      expect(result.counts.daily_activity).toBe(1);
      expect(result.counts.daily_spo2).toBe(1);
      expect(result.counts.daily_stress).toBe(1);
      expect(result.counts.sleep_model).toBe(1);
      // Endpoints with no fixture rows count zero (and are still requested).
      expect(result.counts.workouts).toBe(0);
      expect(result.counts.heartrate).toBe(0);
      expect(result.counts.cardiovascular_age).toBe(0);
    });

    it('flags a sync against an empty db as isFirstSync with a 30-day backfill start date', async () => {
      installFetch({});
      const { out, db } = await runSyncFor('json');
      db.close();

      const { import: result } = out.json as { import: ImportResult; today: DaySummary };
      expect(result.isFirstSync).toBe(true);
      // FROZEN_NOW is 2026-06-15T12:00:00Z; 30 days back is 2026-05-16.
      expect(result.startDate).toBe('2026-05-16');
    });

    it('flags a sync against a db with existing rows as an incremental sync', async () => {
      installFetch(todayFixture());
      const first = await runSyncFor('json');
      first.db.close();

      installFetch({});
      const { out, db } = await runSyncFor('json');
      db.close();

      const { import: result } = out.json as { import: ImportResult; today: DaySummary };
      expect(result.isFirstSync).toBe(false);
      expect(result.startDate).toBe(TODAY);
    });

    it('reads back the freshly-imported rows for today into the today summary', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('json');
      db.close();

      const { today } = out.json as { import: ImportResult; today: DaySummary };
      expect(today.day).toBe(TODAY);
      expect(today.sleep_score).toBe(88);
      expect(today.readiness_score).toBe(77);
      expect(today.activity_score).toBe(90);
      expect(today.steps).toBe(12000);
      expect(today.stress).toBe('normal');
      expect(today.spo2).toBe(97.5);
      expect(today.temp_deviation).toBe(0.2);
      // 28800s / 3600 = 8h, 7200 → 2h deep, 5400 → 1.5h REM.
      expect(today.sleep_hours).toBe(8);
      expect(today.deep_hours).toBe(2);
      expect(today.rem_hours).toBe(1.5);
    });

    it('does not forward a logger to the importer, so no progress lines leak into text() in json mode', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('json');
      db.close();

      // The importer's `_log` is undefined in JSON mode, so the buffered
      // progress lines stay empty and text() falls back to just the summary.
      const text = out.text();
      expect(text).not.toMatch(/Syncing from/);
      expect(text).not.toMatch(/Import complete\./);
    });

    it('summarizes only today, leaving fields null when the imported row is dated a different day', async () => {
      // A readiness row exists, but it is dated yesterday — getDaySummary keys
      // strictly on today's date, so today's readiness_score is null.
      const data = todayFixture();
      data.daily_readiness = [{
        id: 'r-old', day: YESTERDAY, score: 60, contributors: {},
        temperature_deviation: -0.3, temperature_trend_deviation: 0, timestamp: `${YESTERDAY}T00:00:00Z`,
      }];
      installFetch(data);
      const { out, db } = await runSyncFor('json');
      db.close();

      const { today } = out.json as { import: ImportResult; today: DaySummary };
      expect(today.readiness_score).toBeNull();
      expect(today.temp_deviation).toBeNull();
      // Same-day metrics are still present.
      expect(today.sleep_score).toBe(88);
    });

    it('returns an all-null today summary and zero counts when the API has no data', async () => {
      installFetch({});
      const { out, db } = await runSyncFor('json');
      db.close();

      const { import: result, today } = out.json as { import: ImportResult; today: DaySummary };
      expect(Object.values(result.counts).every(c => c === 0)).toBe(true);
      expect(today.day).toBe(TODAY);
      expect(today.sleep_score).toBeNull();
      expect(today.readiness_score).toBeNull();
      expect(today.activity_score).toBeNull();
      expect(today.steps).toBeNull();
    });
  });

  describe('table output', () => {
    it('forwards a logger to the importer so progress lines are buffered into text()', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('table');
      db.close();

      expect(out.text()).toMatch(/Import complete\./);
    });

    it('labels a first sync as a 30-day backfill, naming the resolved date range', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('table');
      db.close();

      expect(out.text()).toContain('First sync — backfilling the last 30 days: 2026-05-16 → 2026-06-15');
    });

    it('labels an incremental sync with just the resolved date range, no "First sync"', async () => {
      installFetch(todayFixture());
      const first = await runSyncFor('table');
      first.db.close();

      installFetch({});
      const { out, db } = await runSyncFor('table');
      db.close();

      const text = out.text();
      expect(text).toContain(`Syncing ${TODAY} → ${TODAY}`);
      expect(text).not.toContain('First sync');
    });

    it('includes a per-collection count summary, including zero counts for empty collections', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('table');
      db.close();

      const text = out.text();
      expect(text).toContain('Imported 2026-05-16 → 2026-06-15:');
      expect(text).toMatch(/sleep 1/);
      // workouts and heartrate have no fixture rows and must still show as 0.
      expect(text).toMatch(/workouts 0/);
      expect(text).toMatch(/heart rate 0/);
    });

    it('ends with exactly formatDaySummary(today, "table")', async () => {
      installFetch(todayFixture());
      const { out, db } = await runSyncFor('table');

      const summary = getDaySummary(db, TODAY);
      db.close();

      expect(out.text().endsWith(formatDaySummary(summary, 'table'))).toBe(true);
    });
  });

  describe('persistence', () => {
    it('writes imported rows to the db file at the configured path', async () => {
      installFetch(todayFixture());
      const { db } = await runSyncFor('json');

      const sleep = db.query('SELECT score FROM daily_sleep WHERE day = ?').get(TODAY) as { score: number } | undefined;
      const activity = db.query('SELECT steps FROM daily_activity WHERE day = ?').get(TODAY) as { steps: number } | undefined;
      db.close();

      expect(sleep?.score).toBe(88);
      expect(activity?.steps).toBe(12000);
    });

    it('creates and migrates the schema on a brand-new db file', async () => {
      // Nothing pre-exists at TEST_DB; runSyncFor must run ensureSchema itself.
      installFetch({});
      const { db } = await runSyncFor('json');

      const version = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null };
      db.close();
      expect(typeof version.v).toBe('number');
      expect(version.v).toBeGreaterThan(0);
    });
  });
});
