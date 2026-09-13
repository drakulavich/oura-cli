import type { Database } from './open.js';
import { identityColumns } from '../collections/index.js';
import type { AnyCollection, SqlValue } from '../collections/index.js';
import { localDateToUtcRange, shiftDay } from '../lib/time.js';

/** One cached row: the collection's columns, as stored. */
export type CachedRow = Record<string, SqlValue>;

/**
 * The cached rows of `c`, as stored: its picked columns, no re-shaping, so a JSON blob such as
 * `contributors` comes back as the string it was written as. A ranged collection is filtered to
 * the local days asked for, both ends inclusive, the way `fetch` bounds its request; a snapshot
 * collection (`rangeParams: 'none'`) has no `day` and returns every row (#73).
 *
 * The daily collections store the local day, so `day BETWEEN` is that filter. A timeseries stores
 * the UTC date of each sample in `day` (a documented quirk), while `fetch hr --day D` asks the API
 * for local day D; so those are bounded on the sample instant instead, with the UTC days that can
 * hold the window as the SQL pre-filter.
 */
export function getRows(db: Database, c: AnyCollection, range: { start: string; end: string } | null, tz: string): CachedRow[] {
  const cols = c.columns.map(k => k.name);
  if (range !== null && !cols.includes('day')) throw new Error(`getRows: ${c.name} has no day column to bound a range on.`);
  // Days first, then whatever identifies a row within the day, so the order is stable across runs.
  const order = [...new Set([...(cols.includes('day') ? ['day'] : []), ...identityColumns(c)])].join(', ');
  const select = `SELECT ${cols.join(', ')} FROM ${c.table}`;
  if (range === null) return db.query(`${select} ORDER BY ${order}`).all() as CachedRow[];

  const between = db.query(`${select} WHERE day BETWEEN ? AND ? ORDER BY ${order}`);
  if (c.rangeParams !== 'datetime') return between.all(range.start, range.end) as CachedRow[];

  const fromMs = Date.parse(localDateToUtcRange(range.start, tz)[0]);
  const toMs = Date.parse(localDateToUtcRange(range.end, tz)[1]);
  const instant = (r: CachedRow) => Date.parse(String(r.timestamp));
  return (between.all(shiftDay(range.start, -1), shiftDay(range.end, 1)) as CachedRow[])
    .filter(r => { const t = instant(r); return t >= fromMs && t < toMs; })
    .sort((a, b) => instant(a) - instant(b));
}
