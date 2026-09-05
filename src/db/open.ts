import { Database } from 'bun:sqlite';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { MIGRATIONS } from './migrations.js';

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
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function schemaVersion(db: Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL)');
  const row = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

export function ensureSchema(db: Database, migrations: Migration[] = MIGRATIONS): void {
  const current = schemaVersion(db);
  for (const m of migrations) {
    if (m.version > current) {
      db.exec(m.sql);
      db.query('INSERT INTO _schema_version (version) VALUES (?)').run(m.version);
    }
  }
}
