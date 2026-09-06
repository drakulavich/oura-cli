import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { getDaySummary, getStats, getTrends } from './queries.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';

const TEST_DB = join(tmpdir(), `oura-queries-test-${Date.now()}.db`);
let db: Database;

beforeAll(() => {
  db = new Database(TEST_DB);
  db.exec('PRAGMA journal_mode = WAL');
  ensureSchema(db);
  db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('s1', '2026-03-01', 82, '{}', '');
  db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('s2', '2026-03-02', 75, '{}', '');
  db.query('INSERT INTO daily_activity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'a1', '2026-03-01', 90, 300, 8000, 5000, 1800, 3600, 7200, 28800, 2200, 500, '{}', '');
});

afterAll(() => {
  db.close();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + '-wal'); } catch {}
  try { unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('getDaySummary', () => {
  describe('when data exists for the requested date', () => {
    it('returns the sleep score, activity score, and step count for that day', () => {
      const summary = getDaySummary(db, '2026-03-01');

      expect(summary.sleep_score).toBe(82);
      expect(summary.activity_score).toBe(90);
      expect(summary.steps).toBe(8000);
    });
  });

  describe('when no data exists for the requested date', () => {
    it('returns null scores so callers can distinguish missing data from a zero score', () => {
      const summary = getDaySummary(db, '2099-01-01');

      expect(summary.sleep_score).toBeNull();
    });
  });
});

describe('getTrends', () => {
  it('covers exactly N calendar days ending today, not N + 1', () => {
    const own = new Database(':memory:'); // keep the shared fixture's row counts intact for getStats
    ensureSchema(own);
    for (let d = 1; d <= 5; d++) {
      own.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run(`t${d}`, `2026-04-0${d}`, 60 + d, '{}', '');
    }
    own.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('future', '2026-04-06', 99, '{}', ''); // must stay out
    const sleepScore = (n: number) => getTrends(own, n, '2026-04-05').find(t => t.label === 'Sleep Score');
    const three = sleepScore(3);
    const one = sleepScore(1);
    own.close();
    expect(three?.count).toBe(3);
    expect(three?.min).toBe(63); // 2026-04-03 is in, 2026-04-02 is out
    expect(three?.max).toBe(65); // 2026-04-06 is out
    expect(one?.count).toBe(1);  // the degenerate window is today alone
  });
});

describe('getStats', () => {
  it('reports the row count for each table so users can verify their local cache', () => {
    const stats = getStats(db, '2026-03-02');
    const sleepTable = stats.tables.find(t => t.table === 'daily_sleep');

    expect(sleepTable?.rows).toBe(2);
  });

  it('reports one row-count entry per registry collection and none for vo2max', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    const stats = getStats(db, '2026-06-15');
    expect(stats.tables.map(t => t.table)).toEqual([
      'daily_sleep', 'daily_readiness', 'daily_activity', 'heartrate', 'daily_spo2',
      'daily_stress', 'workouts', 'sleep_model', 'cardiovascular_age',
    ]);
  });
});
