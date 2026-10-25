import { describe, it, expect } from 'bun:test';
import { resolveRange, assertRangeAllowed } from './fetch.js';
import { byName, fetchCollection, rangeQueries } from '../collections/index.js';
import { OuraClient } from '../api/client.js';
import { pageProgress } from '../lib/progress.js';
import { collectionOf } from './run-command.js';
import { CliError } from '../lib/errors.js';

const T = '2026-06-15';

describe('resolveRange', () => {
  it('defaults to today', () => {
    expect(resolveRange({ today: T })).toEqual({ start: T, end: T });
  });
  it('accepts --day', () => {
    expect(resolveRange({ day: '2026-06-01', today: T })).toEqual({ start: '2026-06-01', end: '2026-06-01' });
  });
  it('accepts --from/--to', () => {
    expect(resolveRange({ from: '2026-06-01', to: '2026-06-07', today: T })).toEqual({ start: '2026-06-01', end: '2026-06-07' });
  });
  it('accepts --days N as the last N days ending today', () => {
    expect(resolveRange({ days: '7', today: T })).toEqual({ start: '2026-06-09', end: T });
  });
  it.each([
    [{ day: '2026-06-01', days: '7' }],
    [{ from: '2026-06-01' }],
    [{ to: '2026-06-01' }],
    [{ from: '2026-06-07', to: '2026-06-01' }],
    [{ day: '06/01/2026' }],
    [{ day: '2026-02-30' }],
    [{ from: '2026-13-01', to: '2026-13-02' }],
    [{ days: '0' }],
    [{ days: 'x' }],
  ])('rejects %j with BAD_ARGS', (opts) => {
    expect(() => resolveRange({ ...opts, today: T })).toThrow(CliError);
    try { resolveRange({ ...opts, today: T }); } catch (e) { expect((e as CliError).code).toBe('BAD_ARGS'); }
  });
});

describe('assertRangeAllowed', () => {
  it('rejects every range flag for a snapshot collection, and accepts none of them being given', () => {
    const ring = byName('ring')!;
    expect(() => assertRangeAllowed(ring, {})).not.toThrow();
    for (const opts of [{ day: '2026-06-15' }, { from: '2026-06-01', to: '2026-06-15' }, { days: '7' }]) {
      let err: unknown;
      try { assertRangeAllowed(ring, opts); } catch (e) { err = e; }
      expect((err as CliError).code).toBe('BAD_ARGS');
    }
  });

  it('lets ranged collections through untouched', () => {
    expect(() => assertRangeAllowed(byName('sleep')!, { days: '7' })).not.toThrow();
  });

  it('gives a snapshot collection one parameterless query whatever the range', () => {
    expect(rangeQueries(byName('ring')!, '2026-06-15', '2026-06-15', 'UTC')).toEqual([{}]);
    expect(rangeQueries(byName('ring')!, '2026-06-20', '2026-06-15', 'UTC')).toEqual([{}]);
  });
});

describe('the progress line of a fetch split into range pieces (#129)', () => {
  it('names the collection and counts pages per request, instead of running one counter across pieces', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      const second = new URL(String(url)).searchParams.has('next_token');
      return new Response(JSON.stringify({ data: second ? [{}] : [{}, {}], next_token: second ? null : 'next' }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const chunks: string[] = [];
    const progress = pageProgress({ write: c => { chunks.push(c); } }, 'fetching', collectionOf);
    const client = new OuraClient({ token: 'test-token', onPage: progress.onPage, onRetry: progress.onRetry });
    try {
      await fetchCollection(client, byName('hr')!, '2026-04-16', '2026-06-15', 'UTC');
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(chunks).toEqual([
      '\r  fetching hr: page 1, 2 rows so far…',
      '\r  fetching hr: page 2, 3 rows so far…',
      '\r  fetching hr: page 1, 5 rows so far…',
      '\r  fetching hr: page 2, 6 rows so far…',
      '\r  fetching hr: page 1, 8 rows so far…',
      '\r  fetching hr: page 2, 9 rows so far…',
    ]);
  });
});
