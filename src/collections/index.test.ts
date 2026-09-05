import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { COLLECTIONS, ddl, insertSql, rowValues, names, byName, rangeQueries } from './index.js';

describe('collection registry', () => {
  it('has unique names, endpoints and tables', () => {
    for (const key of ['name', 'endpoint', 'table'] as const) {
      const vals = COLLECTIONS.map(c => c[key]);
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it('gives every collection exactly one row identity (a pk column or a unique index)', () => {
    for (const c of COLLECTIONS) {
      const pk = c.columns.filter(col => col.pk).length;
      const uniqueIdx = (c.indexes ?? []).filter(i => i.unique).length;
      expect(pk + uniqueIdx).toBe(1);
    }
  });

  it('produces one placeholder per column in insertSql', () => {
    for (const c of COLLECTIONS) {
      const sql = insertSql(c);
      expect((sql.match(/\?/g) ?? []).length).toBe(c.columns.length);
      expect(sql.startsWith(c.conflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE')).toBe(true);
    }
  });

  it('ddl and insertSql round-trip a row through sqlite', () => {
    const c = byName('sleep')!;
    const db = new Database(':memory:');
    db.exec(ddl(c));
    const row = { id: 'x', day: '2026-06-15', score: 81, contributors: { deep_sleep: 1 }, timestamp: 't' };
    db.query(insertSql(c)).run(...rowValues(c, row));
    const back = db.query('SELECT id, day, score, contributors FROM daily_sleep').get();
    expect(back).toEqual({ id: 'x', day: '2026-06-15', score: 81, contributors: '{"deep_sleep":1}' });
  });

  it('exposes names for the fetch enum', () => {
    expect(names()).toContain('sleep');
    expect(byName('nope')).toBeUndefined();
  });
});

describe('rangeQueries', () => {
  it('uses one start_date/end_date query for daily collections, however long the range', () => {
    expect(rangeQueries(byName('sleep')!, '2025-01-01', '2026-09-05', 'Europe/Berlin'))
      .toEqual([{ start_date: '2025-01-01', end_date: '2026-09-05' }]);
  });

  it('uses UTC start_datetime/end_datetime covering the local days for heartrate', () => {
    // Berlin is UTC+2 in June: local midnight is 22:00Z the previous evening.
    expect(rangeQueries(byName('hr')!, '2026-06-01', '2026-06-01', 'Europe/Berlin'))
      .toEqual([{ start_datetime: '2026-05-31T22:00:00Z', end_datetime: '2026-06-01T22:00:00Z' }]);
  });

  it('keeps a heartrate range of exactly 30 days in one query', () => {
    expect(rangeQueries(byName('hr')!, '2026-08-06', '2026-09-04', 'UTC'))
      .toEqual([{ start_datetime: '2026-08-06T00:00:00Z', end_datetime: '2026-09-05T00:00:00Z' }]);
  });

  it('splits a heartrate range longer than 30 days into consecutive pieces of at most 30 days', () => {
    // 31 days: the API answers 400 above 30 days per request.
    expect(rangeQueries(byName('hr')!, '2026-08-06', '2026-09-05', 'UTC')).toEqual([
      { start_datetime: '2026-08-06T00:00:00Z', end_datetime: '2026-09-05T00:00:00Z' },
      { start_datetime: '2026-09-05T00:00:00Z', end_datetime: '2026-09-06T00:00:00Z' },
    ]);
    expect(rangeQueries(byName('hr')!, '2026-01-01', '2026-03-15', 'UTC').map(q => q.start_datetime)).toEqual([
      '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', '2026-03-02T00:00:00Z',
    ]);
  });

  it('every registered collection declares which range parameters its endpoint takes', () => {
    for (const c of COLLECTIONS) {
      expect(c.rangeParams).toBe(c.endpoint === 'heartrate' ? 'datetime' : 'date');
    }
  });
});
