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

  it('re-walks days behind the watermark only where Oura backfills them', () => {
    // #68: Oura adds workout heart-rate samples to days already behind the watermark, so `hr`
    // is the one collection that must look back. Adding another should be a deliberate edit.
    const withLookback = COLLECTIONS.filter(c => c.syncLookbackDays !== undefined);
    expect(withLookback.map(c => c.name)).toEqual(['hr']);
    for (const c of withLookback) expect(Number.isInteger(c.syncLookbackDays) && c.syncLookbackDays! > 0).toBe(true);
  });
});

describe('rangeQueries', () => {
  const hr = byName('hr')!;
  const DAY = 86_400_000;
  const span = (q: Record<string, string>) => Date.parse(q.end_datetime!) - Date.parse(q.start_datetime!) + 1;

  it('uses one start_date/end_date query for daily collections, however long the range', () => {
    expect(rangeQueries(byName('sleep')!, '2025-01-01', '2026-09-05', 'Europe/Berlin'))
      .toEqual([{ start_date: '2025-01-01', end_date: '2026-09-05' }]);
  });

  it('covers the local day with inclusive UTC instants for heartrate: local midnight to 1 ms before the next', () => {
    // Berlin is UTC+2 in June: local midnight is 22:00Z the previous evening.
    expect(rangeQueries(hr, '2026-06-01', '2026-06-01', 'Europe/Berlin'))
      .toEqual([{ start_datetime: '2026-05-31T22:00:00.000Z', end_datetime: '2026-06-01T21:59:59.999Z' }]);
  });

  it('keeps a heartrate range of exactly 30 days in one query', () => {
    expect(rangeQueries(hr, '2026-08-06', '2026-09-04', 'UTC'))
      .toEqual([{ start_datetime: '2026-08-06T00:00:00.000Z', end_datetime: '2026-09-04T23:59:59.999Z' }]);
  });

  it('splits a longer heartrate range into pieces of at most 30 × 24h that neither overlap nor leave gaps', () => {
    // 31 days: the API answers 400 above 30 days per request.
    expect(rangeQueries(hr, '2026-08-06', '2026-09-05', 'UTC')).toEqual([
      { start_datetime: '2026-08-06T00:00:00.000Z', end_datetime: '2026-09-04T23:59:59.999Z' },
      { start_datetime: '2026-09-05T00:00:00.000Z', end_datetime: '2026-09-05T23:59:59.999Z' },
    ]);
    const pieces = rangeQueries(hr, '2026-01-01', '2026-03-15', 'UTC');
    expect(pieces.map(q => q.start_datetime)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z', '2026-03-02T00:00:00.000Z']);
    for (let i = 1; i < pieces.length; i++) {
      expect(Date.parse(pieces[i]!.start_datetime!)).toBe(Date.parse(pieces[i - 1]!.end_datetime!) + 1);
    }
  });

  it('never exceeds 30 × 24h per piece across a DST fall-back (Berlin, October 2026)', () => {
    // Calendar-day chunking would make the first piece 30 days and one hour long.
    const pieces = rangeQueries(hr, '2026-10-01', '2026-11-05', 'Europe/Berlin');
    expect(pieces.length).toBeGreaterThan(1);
    for (const q of pieces) expect(span(q)).toBeLessThanOrEqual(30 * DAY);
    expect(pieces[0]!.start_datetime).toBe('2026-09-30T22:00:00.000Z');
    expect(pieces.at(-1)!.end_datetime).toBe('2026-11-05T22:59:59.999Z'); // CET by then: next midnight is 23:00Z
  });

  it('shifts the bounds for endpoints with exclusive bounds so a single day is one day', () => {
    // sleep: start exclusive, end inclusive → ask from the day before.
    expect(rangeQueries(byName('sleep-periods')!, '2026-09-02', '2026-09-02', 'UTC'))
      .toEqual([{ start_date: '2026-09-01', end_date: '2026-09-02' }]);
    // workout: start inclusive, end exclusive → ask until the day after.
    expect(rangeQueries(byName('workout')!, '2026-08-20', '2026-08-20', 'UTC'))
      .toEqual([{ start_date: '2026-08-20', end_date: '2026-08-21' }]);
    // daily endpoints are inclusive on both sides and get no shift.
    expect(rangeQueries(byName('sleep')!, '2026-09-02', '2026-09-02', 'UTC'))
      .toEqual([{ start_date: '2026-09-02', end_date: '2026-09-02' }]);
  });

  it('returns no queries for an inverted range, for both parameter styles', () => {
    expect(rangeQueries(hr, '2026-06-02', '2026-06-01', 'UTC')).toEqual([]);
    expect(rangeQueries(byName('sleep')!, '2026-06-02', '2026-06-01', 'UTC')).toEqual([]);
  });

  it('declares the live-verified date-bound offsets (a missing offset makes `fetch --day` return nothing)', () => {
    const offsets = Object.fromEntries(COLLECTIONS.map(c => [c.name, c.dayRangeOffset ?? [0, 0]]));
    expect(offsets).toEqual({
      sleep: [0, 0], readiness: [0, 0], activity: [0, 0], hr: [0, 0], spo2: [0, 0], stress: [0, 0],
      workout: [0, 1], 'sleep-periods': [-1, 0], 'cv-age': [0, 0],
      resilience: [0, 0], vo2max: [0, 1], 'sleep-time': [0, 0], session: [0, 1], 'rest-mode': [0, 1], tags: [0, 1],
      ring: [0, 0], battery: [0, 0],
    });
  });

  it('gives every snapshot collection a primary-key column, which the sync replace path keys on', () => {
    for (const c of COLLECTIONS.filter(c => c.rangeParams === 'none')) {
      expect(c.columns.some(col => col.pk)).toBe(true);
    }
  });

  it('every registered collection declares valid range parameters', () => {
    for (const c of COLLECTIONS) {
      const expected = c.endpoint === 'heartrate' || c.endpoint === 'ring_battery_level' ? 'datetime'
        : c.endpoint === 'ring_configuration' ? 'none' : 'date';
      expect(c.rangeParams).toBe(expected);
      if (c.maxRangeDays !== undefined) expect(Number.isInteger(c.maxRangeDays) && c.maxRangeDays > 0).toBe(true);
      if (c.dayRangeOffset) expect(c.dayRangeOffset.every(o => Number.isInteger(o) && Math.abs(o) <= 1)).toBe(true);
    }
  });
});
