import { Database, SQLiteError } from 'bun:sqlite';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { chmodSync, existsSync, mkdirSync } from 'fs';
import { CliError } from '../lib/errors.js';
import { requireValue } from '../lib/require-value.js';
import { MIGRATIONS } from './migrations.js';

export const DB_HINT = 'Check the path in --db / OURA_DB_PATH and that the file is a SQLite database oura-cli created.';
const BUSY_HINT = 'Another oura-cli process is using this database; wait for it to finish and retry.';
const PERMISSION_HINT = 'Check that you can write both the file and the directory holding it — SQLite creates -wal and -shm files alongside the database.';
/** How long a statement waits for a lock held by another process before failing with SQLITE_BUSY. */
const BUSY_TIMEOUT_MS = 5000;
/** Retries for the exclusive lock the WAL switch needs; SQLITE_BUSY there ignores busy_timeout. */
const WAL_SWITCH_ATTEMPTS = 20;
const WAL_SWITCH_WAIT_MS = 25;

function hintFor(detail: string): string {
  if (/database is locked|SQLITE_BUSY/i.test(detail)) return BUSY_HINT;
  // SQLite reports a directory it cannot write as a read-only *database*, which sends the user
  // looking at a file that is fine: WAL and SHM are new files created next to it.
  if (/readonly database|read-only|EACCES|permission denied|unable to open database file/i.test(detail)) return PERMISSION_HINT;
  return DB_HINT;
}

function dbError(what: string, err: unknown): CliError {
  const detail = err instanceof Error ? err.message : String(err);
  return new CliError('DB_ERROR', `${what}: ${detail}`, hintFor(detail));
}

/** The DB_ERROR for a SQLite failure raised by a query (corrupt file, missing table, lock), or undefined for anything else. */
export function asDbError(err: unknown): CliError | undefined {
  return err instanceof SQLiteError ? dbError('Database query failed', err) : undefined;
}

export type { Database };

export interface Migration {
  version: number;
  sql: string;
}

export function getDbPath(explicit?: string): string {
  if (explicit !== undefined) return requireValue(explicit, '--db', 'the default database');
  const fromEnv = process.env.OURA_DB_PATH;
  if (fromEnv !== undefined) return requireValue(fromEnv, 'OURA_DB_PATH', 'the default database');
  return resolve(homedir(), '.oura-cli', 'oura.db');
}

export function openDatabase(explicit?: string): Database {
  const dbPath = getDbPath(explicit);
  try {
    const onDisk = dbPath !== ':memory:';
    const isNew = onDisk && !existsSync(dbPath);
    // The cache holds all of the user's health data: owner-only, like the token file.
    if (onDisk) mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    const db = new Database(dbPath);
    if (isNew) chmodSync(dbPath, 0o600); // before WAL is enabled, so -wal/-shm inherit the mode
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    // Switching the journal mode takes an exclusive lock, which fails while another process
    // reads; the file is already in WAL mode after its first open, so only switch when needed.
    if (journalMode(db) !== 'wal') enableWal(db);
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  } catch (err) {
    throw dbError(`Cannot open database ${dbPath}`, err);
  }
}

function journalMode(db: Database): string {
  return (db.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
}

/**
 * Switching the journal mode takes an exclusive lock, and SQLite answers SQLITE_BUSY immediately
 * rather than waiting out `busy_timeout`. On an existing cache this never runs — the file is
 * already WAL after its first open — but two processes creating the same file race for it, and
 * before this the loser failed at open with DB_ERROR (#77).
 *
 * Losing is not a failure: what this process wants is for the file to be in WAL, whoever set it.
 * So retry briefly, and stop as soon as the mode reads back as WAL.
 */
function enableWal(db: Database): void {
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec('PRAGMA journal_mode = WAL');
      return;
    } catch (err) {
      if (journalMode(db) === 'wal') return; // the other process got there first
      if (attempt >= WAL_SWITCH_ATTEMPTS) throw err;
      Bun.sleepSync(WAL_SWITCH_WAIT_MS);
    }
  }
}

function schemaVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)');
  const row = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/**
 * Bring the schema up to date, once, however many processes ask at the same time.
 *
 * The read of the current version and the writes that follow have to be one atomic step:
 * unsynchronised, eight concurrent commands recorded version 3 twice and ten on a cold cache left
 * 13 rows for 3 migrations (#77). That is harmless only while every migration is `IF NOT EXISTS`;
 * the first `ALTER TABLE ADD COLUMN` would make the loser fail. BEGIN IMMEDIATE takes the write
 * lock up front, and `busy_timeout` (5 s) makes the losers wait rather than fail — they then read
 * the version the winner committed and find nothing left to do.
 */
export function ensureSchema(db: Database, migrations: Migration[] = MIGRATIONS): void {
  try {
    // Outside the transaction: CREATE TABLE IF NOT EXISTS is safe to race, and reading the
    // version first means an up-to-date cache takes no write lock at all.
    if (schemaVersion(db) >= (migrations.at(-1)?.version ?? 0)) return;

    db.exec('BEGIN IMMEDIATE');
    try {
      const current = schemaVersion(db); // re-read: another process may have migrated while we waited
      for (const m of migrations) {
        if (m.version > current) {
          db.exec(m.sql);
          db.query('INSERT INTO _schema_version (version) VALUES (?)').run(m.version);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    throw dbError('Schema migration failed', err);
  }
}
