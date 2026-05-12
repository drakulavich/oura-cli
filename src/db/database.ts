import {
  openDatabase as _openDatabase,
  ensureSchema as _ensureSchema,
  getDbPath as _getDbPath,
} from '../lib/db.js';
import type { DatabaseOptions, Database } from '../lib/db.js';
import { MIGRATIONS } from './schema.js';

const DB_OPTIONS: DatabaseOptions = {
  envVar: 'OURA_DB_PATH',
  defaultDir: '.oura-cli',
  defaultFile: 'oura.db',
};

export function getDbPath(options: DatabaseOptions = {}): string {
  return _getDbPath({ ...DB_OPTIONS, ...options });
}

export function openDatabase(options: DatabaseOptions = {}): Database {
  return _openDatabase({ ...DB_OPTIONS, ...options });
}

export function ensureSchema(db: Database): void {
  _ensureSchema(db, MIGRATIONS);
}
