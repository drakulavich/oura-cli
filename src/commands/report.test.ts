import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from '../db/database.js';
import { getReport } from '../db/report.js';

describe('getReport', () => {
  describe('when called with a 7-day window', () => {
    it('returns at most 7 days of data from an empty database', () => {
      const db = new Database(':memory:');
      ensureSchema(db);

      const r = getReport(db, 7);

      expect(r.days).toBeDefined();
      expect(r.days.length).toBeLessThanOrEqual(7);
    });
  });

  describe('when called with a 30-day window', () => {
    it('returns at most 30 days of data from an empty database', () => {
      const db = new Database(':memory:');
      ensureSchema(db);

      const r = getReport(db, 30);

      expect(r.days).toBeDefined();
      expect(r.days.length).toBeLessThanOrEqual(30);
    });
  });
});
