import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from '../db/database.js';
import { getReport } from '../db/report.js';

describe('getReport', () => {
  it('returns 7-day data for week period', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    const r = getReport(db, 7);
    expect(r.days).toBeDefined();
    expect(r.days.length).toBeLessThanOrEqual(7);
  });

  it('returns 30-day data for month period', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    const r = getReport(db, 30);
    expect(r.days).toBeDefined();
    expect(r.days.length).toBeLessThanOrEqual(30);
  });
});
