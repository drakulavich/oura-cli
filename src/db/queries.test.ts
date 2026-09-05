import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './database.js';
import { getDaySummary, getStats } from './queries.js';
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

describe('getStats', () => {
  it('reports the row count for each table so users can verify their local cache', () => {
    const stats = getStats(db, '2026-03-02');
    const sleepTable = stats.tables.find(t => t.table === 'daily_sleep');

    expect(sleepTable?.rows).toBe(2);
  });
});
