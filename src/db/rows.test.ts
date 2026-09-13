import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { getRows } from './rows.js';
import { byName } from '../collections/index.js';

function seeded(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  const tag = db.query('INSERT INTO enhanced_tags (id, day, end_day, start_time, end_time, tag_type_code, comment, custom_name) VALUES (?,?,?,?,?,?,?,?)');
  tag.run('t3', '2026-09-03', null, '2026-09-03T08:00:00+02:00', null, 'tag_generic_coffee', null, null);
  tag.run('t1b', '2026-09-01', null, '2026-09-01T21:00:00+02:00', null, 'tag_generic_alcohol', 'two glasses', null);
  tag.run('t1a', '2026-09-01', '2026-09-02', '2026-09-01T09:00:00+02:00', '2026-09-02T09:00:00+02:00', null, null, 'sick');
  tag.run('t4', '2026-09-04', null, null, null, 'tag_generic_nap', null, null);
  tag.run('a0', '2026-09-03', null, null, null, 'tag_generic_coffee', null, null); // sorts first by id, third by day
  const ring = db.query('INSERT INTO ring_configuration (id, color, design, firmware_version, hardware_type, set_up_at, size) VALUES (?,?,?,?,?,?,?)');
  ring.run('r2', 'silver', 'horizon', '2.9.30', 'gen3', '2025-01-01T00:00:00+00:00', 9);
  ring.run('r1', 'black', 'heritage', '2.9.30', 'gen3', '2023-06-01T00:00:00+00:00', 10);
  const hr = db.query('INSERT INTO heartrate (bpm, source, timestamp, day) VALUES (?,?,?,?)');
  hr.run(61, 'awake', '2026-09-02T10:00:00+00:00', '2026-09-02');
  hr.run(58, 'rest', '2026-09-01T23:55:00+00:00', '2026-09-01');
  hr.run(55, 'rest', '2026-08-31T22:30:00+00:00', '2026-08-31'); // 00:30 on 1 Sep in Warsaw
  hr.run(70, 'awake', '2026-09-01T22:30:00+00:00', '2026-09-01'); // 00:30 on 2 Sep in Warsaw
  hr.run(63, 'awake', '2026-09-01T10:00:00+00:00', '2026-09-01'); // midday 1 Sep everywhere in Europe
  return db;
}

describe('getRows (#73)', () => {
  it('returns the collection columns as stored, filtered on day with both ends inclusive, oldest day first', () => {
    const rows = getRows(seeded(), byName('tags')!, { start: '2026-09-01', end: '2026-09-03' }, 'UTC');
    expect(rows.map(r => r.id)).toEqual(['t1a', 't1b', 'a0', 't3']); // day first, then id within the day: a0 does not jump the queue
    expect(Object.keys(rows[0]!)).toEqual(['id', 'day', 'end_day', 'start_time', 'end_time', 'tag_type_code', 'comment', 'custom_name']);
    expect(rows[0]).toEqual({
      id: 't1a', day: '2026-09-01', end_day: '2026-09-02', start_time: '2026-09-01T09:00:00+02:00',
      end_time: '2026-09-02T09:00:00+02:00', tag_type_code: null, comment: null, custom_name: 'sick',
    });
  });

  it('keeps a single-day range to that day', () => {
    expect(getRows(seeded(), byName('tags')!, { start: '2026-09-03', end: '2026-09-03' }, 'UTC').map(r => r.id)).toEqual(['a0', 't3']);
    expect(getRows(seeded(), byName('tags')!, { start: '2026-09-05', end: '2026-09-09' }, 'UTC')).toEqual([]);
  });

  it('returns every row of a snapshot collection when no range is given, in key order', () => {
    const rows = getRows(seeded(), byName('ring')!, null, 'UTC');
    expect(rows.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(rows[0]!.size).toBe(10); // INTEGER comes back as a number, not a string
  });

  it('bounds a timeseries on its derived day column', () => {
    const rows = getRows(seeded(), byName('hr')!, { start: '2026-09-01', end: '2026-09-01' }, 'UTC');
    expect(rows.map(r => r.bpm)).toEqual([63, 70, 58]); // by instant; the 2 Sep sample stays out
  });

  it('bounds a timeseries on the local day fetch would ask for, not on the UTC date stored in day', () => {
    // In Warsaw (+02:00) 1 Sep runs 2026-08-31T22:00Z to 2026-09-01T22:00Z: the 22:30Z sample of 31 Aug
    // belongs to it, and the 22:30Z sample of 1 Sep is already 2 Sep. Filtering on day (UTC) got both wrong.
    const rows = getRows(seeded(), byName('hr')!, { start: '2026-09-01', end: '2026-09-01' }, 'Europe/Warsaw');
    expect(rows.map(r => r.timestamp)).toEqual(['2026-08-31T22:30:00+00:00', '2026-09-01T10:00:00+00:00']);
    expect(rows.map(r => r.bpm)).toEqual([55, 63]);
  });

  it('refuses a range for a collection without a day column instead of building bad SQL', () => {
    expect(() => getRows(seeded(), byName('ring')!, { start: '2026-09-01', end: '2026-09-01' }, 'UTC')).toThrow(/no day column/);
  });
});
