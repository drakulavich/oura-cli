import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { COLLECTIONS, ddl, insertSql, rowValues, names, byName } from './index.js';

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
