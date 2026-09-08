import { describe, it, expect, afterEach, afterAll } from 'bun:test';
import { CliError } from '../lib/errors.js';
import { mkdtempSync, writeFileSync, rmSync, statSync, mkdirSync, chmodSync } from 'fs';
import { Database } from 'bun:sqlite';
import { openDatabase, getDbPath, ensureSchema, asDbError, type Migration } from './open.js';
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

      expect(row.version).toBe(3);

      db.close();
    });
  });
});

describe('getDbPath', () => {
  const saved = process.env.OURA_DB_PATH;
  afterEach(() => {
    if (saved === undefined) delete process.env.OURA_DB_PATH; else process.env.OURA_DB_PATH = saved;
  });

  it('rejects an empty --db instead of falling back to the home cache', () => {
    let err: unknown;
    try { getDbPath(''); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('BAD_ARGS');
    expect((err as CliError).message).toContain('--db');
    expect((err as CliError).hint).toContain('remove --db');
  });

  it('rejects a blank --db the same way as an empty one', () => {
    let err: unknown;
    try { getDbPath('   '); } catch (e) { err = e; }
    expect((err as CliError).code).toBe('BAD_ARGS');
  });

  it('rejects an empty OURA_DB_PATH', () => {
    process.env.OURA_DB_PATH = '';
    let err: unknown;
    try { getDbPath(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('BAD_ARGS');
    expect((err as CliError).message).toContain('OURA_DB_PATH');
  });

  it('prefers an explicit path over the environment', () => {
    process.env.OURA_DB_PATH = '/tmp/from-env.db';
    expect(getDbPath('/tmp/explicit.db')).toBe('/tmp/explicit.db');
  });

  it('falls back to the home cache when nothing is set', () => {
    delete process.env.OURA_DB_PATH;
    expect(getDbPath()).toContain('.oura-cli');
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

  it('blames directory permissions, not the file format, when the directory is read-only', () => {
    // #78: SQLite reports a directory it cannot write as a read-only *database*, and the generic
    // hint sent the user to inspect a file that was fine.
    const ro = join(dir, 'readonly');
    mkdirSync(ro, { recursive: true });
    const path = join(ro, 'oura.db');
    openDatabase(path).close();
    chmodSync(ro, 0o500);
    let err: unknown;
    try {
      const db = openDatabase(path);
      db.exec('CREATE TABLE t (x)');
      db.close();
    } catch (e) { err = asDbError(e) ?? e; }
    chmodSync(ro, 0o700); // so the temp dir can be removed
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('DB_ERROR');
    expect((err as CliError).hint).toContain('directory');
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

describe('concurrent migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oura-migrate-'));
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('records each migration once when several processes migrate the same cold cache', async () => {
    // #77: check-and-apply had no lock, so ten concurrent commands left 13 rows for 3 migrations.
    // Harmless while every migration is IF NOT EXISTS; the first ALTER TABLE would fail the loser.
    const path = join(dir, 'cold.db');
    const procs = Array.from({ length: 4 }, () => Bun.spawn(
      ['bun', 'run', 'src/index.ts', 'db', 'stats', '--db', path, '--format', 'json'],
      { stdout: 'pipe', stderr: 'pipe' },
    ));
    const codes = await Promise.all(procs.map(p => p.exited));
    expect(codes).toEqual([0, 0, 0, 0]);

    const db = new Database(path);
    const rows = db.query('SELECT version, COUNT(*) AS n FROM _schema_version GROUP BY version').all() as Array<{ version: number; n: number }>;
    db.close();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.n).toBe(1);
  }, 20_000);

  it('waits for the process holding the write lock instead of racing it', () => {
    const path = join(dir, 'locked.db');
    const holder = openDatabase(path);
    ensureSchema(holder);
    const other = openDatabase(path);
    other.exec('PRAGMA busy_timeout = 200'); // keep the test quick if the lock is not released

    holder.exec('BEGIN IMMEDIATE');
    try {
      // The schema is already current, so this must not ask for a write lock at all.
      expect(() => ensureSchema(other)).not.toThrow();
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
      other.close();
    }
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
