import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema, type Migration } from './db.js';

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
});
