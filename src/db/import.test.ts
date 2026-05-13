import { describe, it, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './database.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';

const TEST_DB = join(tmpdir(), `oura-import-test-${Date.now()}.db`);

afterEach(() => {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + '-wal'); } catch {}
  try { unlinkSync(TEST_DB + '-shm'); } catch {}
});

describe('Import', () => {
  describe('upsert behaviour', () => {
    it('overwrites an existing row when the same id is imported again so re-syncs stay idempotent', () => {
      const db = new Database(TEST_DB);
      db.exec('PRAGMA journal_mode = WAL');
      ensureSchema(db);

      db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)')
        .run('id1', '2026-03-05', 80, '{}', '2026-03-05T00:00:00Z');
      db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)')
        .run('id1', '2026-03-05', 85, '{}', '2026-03-05T00:00:00Z');

      const row = db.query('SELECT score FROM daily_sleep WHERE id = ?').get('id1') as { score: number };
      expect(row.score).toBe(85);

      db.close();
    });
  });
});
