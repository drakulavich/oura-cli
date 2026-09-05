import { describe, it, expect, afterEach } from 'bun:test';
import { CliError } from '../lib/errors.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { Database } from 'bun:sqlite';
import { openDatabase, ensureSchema, type Migration } from './open.js';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_MIGRATIONS: Migration[] = [
  { version: 1, sql: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)' },
];

describe('ensureSchema', () => {
  describe('on first run', () => {
    it('applies all pending migrations so the database is ready to use', () => {
      const db = new Database(':memory:');

      ensureSchema(db, TEST_MIGRATIONS);

      const row = db.query("SELECT name FROM sqlite_master WHERE name = 't'").get();
      expect(row).not.toBeNull();
    });
  });

  describe('on subsequent runs', () => {
    it('skips already-applied migrations so the schema version stays stable', () => {
      const db = new Database(':memory:');
      ensureSchema(db, TEST_MIGRATIONS);

      ensureSchema(db, TEST_MIGRATIONS);

      const r = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number };
      expect(r.v).toBe(1);
    });
  });

  describe('on upgrade', () => {
    it('applies only the newer migrations without re-running already-applied ones', () => {
      const db = new Database(':memory:');
      ensureSchema(db, TEST_MIGRATIONS);

      ensureSchema(db, [
        ...TEST_MIGRATIONS,
        { version: 2, sql: 'CREATE TABLE IF NOT EXISTS t2 (id INTEGER PRIMARY KEY)' },
      ]);

      const row = db.query("SELECT name FROM sqlite_master WHERE name = 't2'").get();
      expect(row).not.toBeNull();
    });
  });

  it('applies only migrations newer than the recorded version', () => {
    const db = new Database(':memory:');
    ensureSchema(db, [{ version: 1, sql: 'CREATE TABLE a (x)' }]);
    ensureSchema(db, [{ version: 1, sql: 'CREATE TABLE a (x)' }, { version: 2, sql: 'CREATE TABLE b (y)' }]);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(['_schema_version', 'a', 'b']);
  });
});

const TEST_DB = join(tmpdir(), `oura-test-${Date.now()}.db`);

afterEach(() => {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + '-wal'); } catch {}
  try { unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('Database', () => {
  describe('schema initialisation', () => {
    it('creates all expected tables so queries can run without setup errors', () => {
      const db = openDatabase(TEST_DB);
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
      const db = openDatabase(TEST_DB);
      ensureSchema(db);

      const row = db.query('SELECT MAX(version) as version FROM _schema_version').get() as { version: number };

      expect(row.version).toBe(2);

      db.close();
    });
  });
});

describe('openDatabase errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oura-open-'));

  it('reports a file that is not a database as DB_ERROR with a hint', () => {
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'this is not sqlite');
    let err: unknown;
    try { openDatabase(junk); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('DB_ERROR');
    expect((err as CliError).message).toContain(junk);
    expect((err as CliError).hint).toContain('OURA_DB_PATH');
  });

  it('reports an unusable path (parent is a regular file) as DB_ERROR', () => {
    const file = join(dir, 'afile');
    writeFileSync(file, '');
    let err: unknown;
    try { openDatabase(join(file, 'x.db')); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('DB_ERROR');
  });
});
