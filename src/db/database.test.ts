import { describe, it, expect, afterEach } from 'bun:test';
import { openDatabase, ensureSchema } from './database.js';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_DB = join(tmpdir(), `oura-test-${Date.now()}.db`);

afterEach(() => {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + '-wal'); } catch {}
  try { unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('Database', () => {
  describe('schema initialisation', () => {
    it('creates all expected tables so queries can run without setup errors', () => {
      const db = openDatabase({ dbPath: TEST_DB });
      ensureSchema(db);

      const tables = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as { name: string }[];
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toEqual(expect.arrayContaining([
        'daily_sleep', 'heartrate', 'workouts', '_schema_version',
      ]));

      db.close();
    });

    it('records the current schema version so incremental migrations can be tracked', () => {
      const db = openDatabase({ dbPath: TEST_DB });
      ensureSchema(db);

      const row = db.query('SELECT MAX(version) as version FROM _schema_version').get() as { version: number };

      expect(row.version).toBe(2);

      db.close();
    });
  });
});
