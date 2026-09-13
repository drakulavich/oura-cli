import { describe, it, expect } from 'bun:test';
import { pageProgress } from './progress.js';

describe('pageProgress (#45)', () => {
  function sink(): { chunks: string[]; write: (c: string) => void } {
    const chunks: string[] = [];
    return { chunks, write: c => { chunks.push(c); } };
  }

  it('rewrites one line in place, counting pages and rows across calls', () => {
    const s = sink();
    const p = pageProgress(s, 'fetching');
    p.onPage({ endpoint: 'heartrate', rows: 1000 });
    p.onPage({ endpoint: 'heartrate', rows: 0 });
    p.onPage({ endpoint: 'heartrate', rows: 5 });
    expect(s.chunks).toEqual([
      '\r  fetching heartrate: page 1, 1000 rows so far…',
      '\r  fetching heartrate: page 2, 1000 rows so far…',
      '\r  fetching heartrate: page 3, 1005 rows so far…',
    ]);
  });

  it('starts the count over when the endpoint changes, as a sync moves from collection to collection', () => {
    const s = sink();
    const p = pageProgress(s, 'syncing');
    p.onPage({ endpoint: 'daily_sleep', rows: 3 });
    p.onPage({ endpoint: 'heartrate', rows: 1000 });
    expect(s.chunks[1]).toBe('\r  syncing heartrate: page 1, 1000 rows so far…');
  });

  it('says when it is waiting on a 429, before the first page and mid-way', () => {
    const s = sink();
    const p = pageProgress(s, 'fetching');
    p.onRetry({ endpoint: 'heartrate', waitMs: 30_000 });
    p.onPage({ endpoint: 'heartrate', rows: 1000 });
    p.onRetry({ endpoint: 'heartrate', waitMs: 1_500 });
    expect(s.chunks).toEqual([
      '\r  fetching heartrate; rate limited, retrying in 30 s…',
      '\r  fetching heartrate: page 1, 1000 rows so far…',
      '\r  fetching heartrate: page 1, 1000 rows so far; rate limited, retrying in 2 s…',
    ]);
  });

  it('wipes the line on done, as wide as the widest line it wrote', () => {
    const s = sink();
    const p = pageProgress(s, 'fetching');
    p.onPage({ endpoint: 'heartrate', rows: 12345 });
    p.onRetry({ endpoint: 'heartrate', waitMs: 60_000 });
    p.onPage({ endpoint: 'heartrate', rows: 0 });
    p.done();
    const widest = Math.max(...s.chunks.slice(0, 3).map(c => c.length - 1));
    expect(s.chunks[3]).toBe(`\r${' '.repeat(widest)}\r`);
  });

  it('wipes a line that only a retry wrote, so a command that dies in its first 429 wait leaves nothing behind', () => {
    const s = sink();
    const p = pageProgress(s, 'fetching');
    p.onRetry({ endpoint: 'heartrate', waitMs: 30_000 });
    p.done();
    expect(s.chunks).toHaveLength(2);
    expect(s.chunks[1]).toMatch(/^\r +\r$/);
  });

  it('writes nothing at all when nothing ever happened', () => {
    const s = sink();
    pageProgress(s, 'fetching').done();
    expect(s.chunks).toEqual([]);
  });
});
