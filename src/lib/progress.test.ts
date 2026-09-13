import { describe, it, expect } from 'bun:test';
import { pageProgress } from './progress.js';

describe('pageProgress (#45)', () => {
  function sink(): { chunks: string[]; write: (c: string) => void } {
    const chunks: string[] = [];
    return { chunks, write: c => { chunks.push(c); } };
  }

  it('rewrites one line in place, counting pages and rows across calls', () => {
    const s = sink();
    const p = pageProgress(s, 'fetching hr');
    p.onPage({ rows: 1000 });
    p.onPage({ rows: 0 });
    p.onPage({ rows: 5 });
    expect(s.chunks).toEqual([
      '\r  fetching hr: page 1, 1000 rows so far…',
      '\r  fetching hr: page 2, 1000 rows so far…',
      '\r  fetching hr: page 3, 1005 rows so far…',
    ]);
  });

  it('wipes the line on done, as wide as the widest line it wrote', () => {
    const s = sink();
    const p = pageProgress(s, 'fetching hr');
    p.onPage({ rows: 12345 });
    p.onPage({ rows: 0 });
    p.done();
    const widest = Math.max(...s.chunks.slice(0, 2).map(c => c.length - 1));
    expect(s.chunks[2]).toBe(`\r${' '.repeat(widest)}\r`);
  });

  it('writes nothing at all when no page ever arrived', () => {
    const s = sink();
    pageProgress(s, 'fetching hr').done();
    expect(s.chunks).toEqual([]);
  });
});
