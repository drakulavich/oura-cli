import { describe, it, expect, afterEach, afterAll } from 'bun:test';
import { CliError } from '../lib/errors.js';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'fs';
import { Database } from 'bun:sqlite';
import { openDatabase, ensureSchema, asDbError, type Migration } from './open.js';
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
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

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

describe('openDatabase concurrency and permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oura-open2-'));
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates the directory 0700 and the file 0600', () => {
    const path = join(dir, 'private', 'oura.db');
    const db = openDatabase(path);
    db.close();
    expect(statSync(join(dir, 'private')).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('opens while another connection holds a write transaction and reads through it', () => {
    const path = join(dir, 'shared.db');
    const writer = openDatabase(path);
    ensureSchema(writer);
    writer.exec('BEGIN IMMEDIATE');
    writer.exec("INSERT INTO daily_sleep (id, day) VALUES ('x', '2026-01-01')");
    try {
      const reader = openDatabase(path); // used to fail: PRAGMA journal_mode = WAL needs an exclusive lock
      const row = reader.query('SELECT COUNT(*) AS n FROM daily_sleep').get() as { n: number };
      expect(row.n).toBe(0); // WAL: readers see the last committed state
      reader.close();
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
  });

  it('names lock contention in the hint instead of blaming the path', () => {
    const path = join(dir, 'locked.db');
    const a = openDatabase(path);
    ensureSchema(a);
    const b = openDatabase(path);
    b.exec('PRAGMA busy_timeout = 50'); // keep the test fast
    a.exec('BEGIN IMMEDIATE');
    try {
      let err: unknown;
      try { b.exec("INSERT INTO daily_sleep (id, day) VALUES ('y', '2026-01-02')"); } catch (e) { err = asDbError(e); }
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('DB_ERROR');
      expect((err as CliError).hint).toContain('Another oura-cli process');
    } finally {
      a.exec('ROLLBACK'); a.close(); b.close();
    }
  });
});
