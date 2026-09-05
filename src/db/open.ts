import { Database, SQLiteError } from 'bun:sqlite';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { CliError } from '../lib/errors.js';
import { MIGRATIONS } from './migrations.js';

export const DB_HINT = 'Check the path in --db / OURA_DB_PATH and that the file is a SQLite database oura-cli created.';

function dbError(what: string, err: unknown): CliError {
  const detail = err instanceof Error ? err.message : String(err);
  return new CliError('DB_ERROR', `${what}: ${detail}`, DB_HINT);
}

/** The DB_ERROR for a SQLite failure raised by a query (corrupt file, missing table), or undefined for anything else. */
export function asDbError(err: unknown): CliError | undefined {
  return err instanceof SQLiteError ? new CliError('DB_ERROR', err.message, DB_HINT) : undefined;
}

export type { Database };

export interface Migration {
  version: number;
  sql: string;
}

export function getDbPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.OURA_DB_PATH) return process.env.OURA_DB_PATH;
  return resolve(homedir(), '.oura-cli', 'oura.db');
}

export function openDatabase(explicit?: string): Database {
  const dbPath = getDbPath(explicit);
  try {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  } catch (err) {
    throw dbError(`Cannot open database ${dbPath}`, err);
  }
}

function schemaVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)');
  const row = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

export function ensureSchema(db: Database, migrations: Migration[] = MIGRATIONS): void {
  try {
    const current = schemaVersion(db);
    for (const m of migrations) {
      if (m.version > current) {
        db.exec(m.sql);
        db.query('INSERT INTO _schema_version (version) VALUES (?)').run(m.version);
      }
    }
  } catch (err) {
    throw dbError('Schema migration failed', err);
  }
}
