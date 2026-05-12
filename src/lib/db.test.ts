import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema, type Migration } from './db.js';

const TEST_MIGRATIONS: Migration[] = [
  { version: 1, sql: 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)' },
];

describe('ensureSchema', () => {
  it('applies a migration on first run', () => {
    const db = new Database(':memory:');
    ensureSchema(db, TEST_MIGRATIONS);
    const row = db.query("SELECT name FROM sqlite_master WHERE name = 't'").get();
    expect(row).not.toBeNull();
  });

  it('is idempotent on second run', () => {
    const db = new Database(':memory:');
    ensureSchema(db, TEST_MIGRATIONS);
    ensureSchema(db, TEST_MIGRATIONS);
    const r = db.query('SELECT MAX(version) AS v FROM _schema_version').get() as { v: number };
    expect(r.v).toBe(1);
  });

  it('applies newer migrations on upgrade', () => {
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
