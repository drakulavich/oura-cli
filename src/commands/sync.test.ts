import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { runSync } from './sync.js';
import { ensureSchema } from '../db/database.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary } from '../format.js';
import { CliError } from '../lib/errors.js';

// Characterization tests for `runSync` (src/commands/sync.ts) — the thin
// orchestration layer that resolves output format, opens/migrates the local
// sqlite cache, runs an API import, then reads back "today"'s summary and
// prints it. Boundaries are mocked exactly where the code touches the outside
// world: HTTP via a `globalThis.fetch` stub, sqlite via a temp db file. The
// module's own collaborators (importDaily, getDaySummary, formatDaySummary,
// resolveFormat) are exercised for real.

const realFetch = globalThis.fetch;
const realLog = console.log;

// UTC "today", matching what todayDate('UTC') → todayLocal('UTC') resolves to
// (formatLocalDate over nowUtc()). We drive runSync with tz='UTC' so the
// summarized day is deterministic and equals this value.
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

let TEST_DB: string;
let logs: string[];
let fetchCalls: string[];

function removeDb(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch {}
  }
}

// Install a fetch stub that returns `{ data: rows }` keyed by the Oura
// endpoint (the last path segment of the request URL). Unlisted endpoints
// return an empty data array. Records every requested endpoint in fetchCalls.
function installFetch(dataByEndpoint: Record<string, unknown[]>): void {
  globalThis.fetch = (async (url: unknown) => {
    const endpoint = new URL(String(url)).pathname.split('/').pop() ?? '';
    fetchCalls.push(endpoint);
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

beforeEach(() => {
  TEST_DB = join(tmpdir(), `oura-sync-test-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);
  logs = [];
  fetchCalls = [];
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  process.env.OURA_TOKEN = 'test-token';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  delete process.env.OURA_TOKEN;
  removeDb(TEST_DB);
});

describe('runSync', () => {
  describe('format resolution', () => {
    it('defaults to JSON when no --format is given and stdout is not a TTY', async () => {
      // In the test runner process.stdout.isTTY is undefined, so the default
      // branch of resolveFormat picks JSON.
      installFetch({});
      await runSync({ db: TEST_DB, tz: 'UTC' });

      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0]!);
      expect(parsed).toHaveProperty('import');
      expect(parsed).toHaveProperty('today');
    });

    it('throws a BAD_ARGS CliError for an unknown --format before any fetch or db work', async () => {
      installFetch(todayFixture());
      let caught: unknown;
      try {
        await runSync({ format: 'xml', db: TEST_DB, tz: 'UTC' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).code).toBe('BAD_ARGS');
      // resolveFormat runs first, so no HTTP request is ever issued.
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe('JSON output', () => {
    it('prints a single { import, today } object', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      expect(logs).toHaveLength(1);
      const parsed = JSON.parse(logs[0]!);
      expect(Object.keys(parsed).sort()).toEqual(['import', 'today']);
    });

    it('reports the import window and per-endpoint counts in the import payload', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      const { import: result } = JSON.parse(logs[0]!);
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

    it('reads back the freshly-imported rows for today into the today summary', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      const { today } = JSON.parse(logs[0]!);
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

    it('does not forward a logger to the importer, so no progress lines leak into JSON mode', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      // The importer's `_log` is undefined in JSON mode; the only console.log
      // call is the final JSON blob.
      expect(logs).toHaveLength(1);
      expect(logs[0]).not.toMatch(/Syncing from/);
      expect(logs[0]).not.toMatch(/Import complete\./);
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
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      const { today } = JSON.parse(logs[0]!);
      expect(today.readiness_score).toBeNull();
      expect(today.temp_deviation).toBeNull();
      // Same-day metrics are still present.
      expect(today.sleep_score).toBe(88);
    });

    it('returns an all-null today summary and zero counts when the API has no data', async () => {
      installFetch({});
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      const { import: result, today } = JSON.parse(logs[0]!);
      expect(Object.values(result.counts).every(c => c === 0)).toBe(true);
      expect(today.day).toBe(TODAY);
      expect(today.sleep_score).toBeNull();
      expect(today.readiness_score).toBeNull();
      expect(today.activity_score).toBeNull();
      expect(today.steps).toBeNull();
    });
  });

  describe('table output', () => {
    it('forwards console.log to the importer so progress lines are printed', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'table', db: TEST_DB, tz: 'UTC' });

      const joined = logs.join('\n');
      expect(joined).toMatch(/Syncing from .* to /);
      expect(joined).toMatch(/Import complete\./);
    });

    it('prints exactly formatDaySummary(today, "table") as its final line', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'table', db: TEST_DB, tz: 'UTC' });

      // Reconstruct what the summary should be by reopening the persisted db.
      const db = new Database(TEST_DB);
      const summary = getDaySummary(db, TODAY);
      db.close();

      expect(logs[logs.length - 1]).toBe(formatDaySummary(summary, 'table'));
    });
  });

  describe('persistence', () => {
    it('writes imported rows to the db file at the configured path', async () => {
      installFetch(todayFixture());
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      const db = new Database(TEST_DB);
      const sleep = db.query('SELECT score FROM daily_sleep WHERE day = ?').get(TODAY) as { score: number } | undefined;
      const activity = db.query('SELECT steps FROM daily_activity WHERE day = ?').get(TODAY) as { steps: number } | undefined;
      db.close();

      expect(sleep?.score).toBe(88);
      expect(activity?.steps).toBe(12000);
    });

    it('creates and migrates the schema on a brand-new db file', async () => {
      // Nothing pre-exists at TEST_DB; runSync must run ensureSchema itself.
      installFetch({});
      await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });

      const db = new Database(TEST_DB);
      const version = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null };
      db.close();
      expect(typeof version.v).toBe('number');
      expect(version.v).toBeGreaterThan(0);
    });
  });

  describe('authentication', () => {
    it('propagates a TOKEN_MISSING CliError when no token can be resolved', async () => {
      installFetch(todayFixture());
      delete process.env.OURA_TOKEN;
      const prevPath = process.env.OURA_TOKEN_PATH;
      process.env.OURA_TOKEN_PATH = join(tmpdir(), `no-such-oura-token-${process.pid}`);
      removeDb(process.env.OURA_TOKEN_PATH);

      let caught: unknown;
      try {
        await runSync({ format: 'json', db: TEST_DB, tz: 'UTC' });
      } catch (e) {
        caught = e;
      } finally {
        if (prevPath === undefined) delete process.env.OURA_TOKEN_PATH;
        else process.env.OURA_TOKEN_PATH = prevPath;
      }

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).code).toBe('TOKEN_MISSING');
    });
  });
});
