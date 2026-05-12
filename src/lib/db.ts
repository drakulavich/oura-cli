import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

export type { Database };

export interface DatabaseOptions {
  dbPath?: string;
  envVar?: string;
  defaultDir?: string;
  defaultFile?: string;
}

export interface Migration {
  version: number;
  sql: string;
}

export function getDbPath(options: DatabaseOptions = {}): string {
  if (options.dbPath) return options.dbPath;
  if (options.envVar && process.env[options.envVar]) return process.env[options.envVar]!;
  const dir = options.defaultDir ?? '.oura-cli';
  const file = options.defaultFile ?? 'oura.db';
  return resolve(homedir(), dir, file);
}

export function openDatabase(options: DatabaseOptions = {}): Database {
  const dbPath = getDbPath(options);
  if (dbPath !== ':memory:') {
    mkdirSync(resolve(dbPath, '..'), { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function getSchemaVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)');
  const row = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

export function ensureSchema(db: Database, migrations: Migration[]): void {
  const current = getSchemaVersion(db);
  for (const m of migrations) {
    if (m.version > current) {
      db.exec(m.sql);
      db.query('INSERT INTO _schema_version (version) VALUES (?)').run(m.version);
    }
  }
}
