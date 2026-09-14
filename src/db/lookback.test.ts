import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { importDaily } from './sync.js';
import { lookbackRange } from './lookback.js';
import { byName } from '../collections/index.js';
import type { OuraClient } from '../api/client.js';
import type { OuraEndpoint } from '../api/types.js';

/**
 * A fake Oura that holds heart-rate samples and answers each request with the ones inside its
 * window, recording every heartrate query it received.
 */
function api(samples: Array<{ timestamp: string; source?: string }>) {
  const hrQueries: Array<Record<string, string>> = [];
  const client = {
    fetch: async (endpoint: OuraEndpoint, query: Record<string, string>) => {
      if (endpoint !== 'heartrate') return [];
      hrQueries.push(query);
      const from = Date.parse(query.start_datetime!);
      const to = Date.parse(query.end_datetime!);
      return samples
        .filter(s => { const t = Date.parse(s.timestamp); return t >= from && t <= to; })
        .map(s => ({ timestamp: s.timestamp, bpm: 60, source: s.source ?? 'awake' }));
    },
  } as unknown as OuraClient;
  return { client, hrQueries, windows: () => hrQueries.map(q => `${q.start_datetime!.slice(0, 10)}..${q.end_datetime!.slice(0, 10)}`) };
}

function cacheWithHr(day: string, instant = `${day}T10:00:00+00:00`): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  db.query("INSERT INTO heartrate (timestamp, bpm, source, day) VALUES (?, 60, 'awake', ?)").run(instant, day);
  db.query("INSERT INTO daily_sleep (id, day) VALUES ('s', ?)").run(day);
  return db;
}

const clock = { today: '2026-06-15', tz: 'UTC' };

describe('heart-rate lookback (#135)', () => {
  it('re-reads the fortnight behind the watermark on the first sync of the day, even when nothing is new', async () => {
    const db = cacheWithHr('2026-06-14');
    const { client, windows } = api([]);
    await importDaily(db, client, clock);
    db.close();
    expect(windows()).toEqual(['2026-06-14..2026-06-15', '2026-05-31..2026-06-13']);
  });

  it('skips the fortnight on a repeat sync the same day when the tail brings nothing newer than the cache', async () => {
    // The no-op sync of the issue: nineteen of thirty-eight requests, replacing 18,000 rows with themselves.
    const db = cacheWithHr('2026-06-14');
    const { client, windows, hrQueries } = api([{ timestamp: '2026-06-14T10:00:00+00:00' }]); // the stored sample, nothing more
    await importDaily(db, client, clock);
    hrQueries.length = 0;
    const second = await importDaily(db, client, clock);
    db.close();
    expect(windows()).toEqual(['2026-06-14..2026-06-15']);
    expect(second.fetched.heartrate).toBe(1);
  });

  it('re-reads the fortnight again the same day once the tail holds a sample newer than any stored: the ring has uploaded', async () => {
    const db = cacheWithHr('2026-06-14');
    const samples: Array<{ timestamp: string; source?: string }> = [{ timestamp: '2026-06-14T10:00:00+00:00' }];
    const { client, windows, hrQueries } = api(samples);
    await importDaily(db, client, clock);
    hrQueries.length = 0;
    samples.push({ timestamp: '2026-06-15T08:00:00+00:00' }); // the upload
    samples.push({ timestamp: '2026-06-05T12:00:00+00:00', source: 'workout' }); // and what it appended behind the watermark
    const result = await importDaily(db, client, clock);
    db.close();
    expect(windows()).toEqual(['2026-06-14..2026-06-15', '2026-05-31..2026-06-13']);
    expect(result.added.heartrate).toBe(2);
  });

  it('runs the fortnight once more when the local day changes, whether or not anything arrived', async () => {
    const db = cacheWithHr('2026-06-14');
    const { client, windows, hrQueries } = api([{ timestamp: '2026-06-14T10:00:00+00:00' }]);
    await importDaily(db, client, clock);
    hrQueries.length = 0;
    await importDaily(db, client, { today: '2026-06-16', tz: 'UTC' });
    db.close();
    expect(windows()).toEqual(['2026-06-14..2026-06-16', '2026-05-31..2026-06-13']);
  });

  it('remembers the day it ran in _sync_state, per collection table', async () => {
    const db = cacheWithHr('2026-06-14');
    const { client } = api([]);
    await importDaily(db, client, clock);
    const rows = db.query('SELECT key, value FROM _sync_state ORDER BY key').all();
    db.close();
    expect(rows).toEqual([{ key: 'lookback:heartrate', value: '2026-06-15' }]);
  });

  it('never re-reads behind an explicit --from, nor on a first sync, and leaves collections without a lookback alone', () => {
    const hr = byName('hr')!;
    expect(lookbackRange(hr, '2026-06-14', undefined)).toEqual({ start: '2026-05-31', end: '2026-06-13' });
    expect(lookbackRange(hr, '2026-06-14', '2026-06-01')).toBeNull();
    expect(lookbackRange(hr, null, undefined)).toBeNull();
    expect(lookbackRange(byName('sleep')!, '2026-06-14', undefined)).toBeNull();
  });

  it('treats a sample with no usable instant as no evidence of an upload', async () => {
    const db = cacheWithHr('2026-06-14');
    const { client, windows, hrQueries } = api([{ timestamp: '2026-06-14T10:00:00+00:00' }]);
    await importDaily(db, client, clock);
    hrQueries.length = 0;
    const junk = { fetch: async (endpoint: OuraEndpoint, query: Record<string, string>) => {
      if (endpoint !== 'heartrate') return [];
      hrQueries.push(query);
      return [{ timestamp: 'not a time', bpm: 60, source: 'awake' }, { timestamp: null, bpm: 61, source: 'awake' }];
    } } as unknown as OuraClient;
    await importDaily(db, junk, clock);
    db.close();
    expect(windows()).toEqual(['2026-06-14..2026-06-15']);
  });
});

describe('the lookback marker follows the rows (#135, review)', () => {
  it('is not written when the run fetched the fortnight but failed to store it, so the same-day rerun tries again', async () => {
    const db = cacheWithHr('2026-06-14');
    const { client } = api([{ timestamp: '2026-06-14T10:00:00+00:00' }]);
    db.exec("CREATE TRIGGER refuse BEFORE INSERT ON heartrate BEGIN SELECT RAISE(ABORT, 'disk full'); END"); // the insert transaction fails
    await expect(importDaily(db, client, clock)).rejects.toThrow('disk full');
    const rows = db.query('SELECT key FROM _sync_state').all();
    db.close();
    expect(rows).toEqual([]);
  });
});
