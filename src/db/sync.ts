import type { Database } from './open.js';
import type { OuraClient } from '../api/client.js';
import { COLLECTIONS, fetchCollection, insertSql, rowValues } from '../collections/index.js';
import { shiftDay } from '../lib/time.js';

/** Days (inclusive) a collection's first sync covers. */
export const BACKFILL_DAYS = 30;

export interface ImportResult {
  /** Earliest day requested across collections. */
  startDate: string;
  endDate: string;
  /** Rows the API returned, per table. */
  fetched: Record<string, number>;
  /**
   * Net growth of each table: days (or heartrate samples) it did not hold before this run.
   * A re-fetched row that replaces or is ignored by the one already stored — including a
   * recomputed day that arrives under a new id — counts as fetched, not as new.
   */
  added: Record<string, number>;
  /** True when every table was empty before this run. */
  isFirstSync: boolean;
}

export interface SyncClock {
  /** YYYY-MM-DD in `tz` */
  today: string;
  tz: string;
}

/** An explicit window (`sync --from/--to`) replaces each collection's own watermark. */
export interface SyncWindow {
  from?: string;
  to?: string;
}

function lastDay(db: Database, table: string): string | null {
  return (db.query(`SELECT MAX(day) AS d FROM ${table}`).get() as { d: string | null }).d;
}

function rowCount(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

export async function importDaily(
  db: Database, client: OuraClient, clock: SyncClock, log?: (msg: string) => void, window: SyncWindow = {},
): Promise<ImportResult> {
  const { today, tz } = clock;
  const _log = log ?? (() => {});
  const end = window.to ?? today;
  const backfillStart = shiftDay(end, -(BACKFILL_DAYS - 1));

  // Each collection resumes from its own last stored day. A run that stops half-way therefore
  // leaves the untouched tables to be picked up next time, instead of hiding them behind a
  // watermark that only the first few tables advanced.
  // Snapshot collections (rangeParams 'none') have no day column and are fetched whole every run.
  const plan = COLLECTIONS.map(c => {
    const last = c.rangeParams === 'none' ? null : lastDay(db, c.table);
    // A watermark past the end of the window inverts the range, and an inverted range fetches
    // nothing at all — silently. That happens whenever the resolved timezone is west of the one
    // the cache was built in (a travelling laptop, OURA_TZ, --tz), and permanently for a
    // collection whose day can be in the future (a tag dated next year). Clamp instead: the
    // end day is always requested, so the run is a re-fetch rather than a no-op. An explicit
    // --from is never clamped — `resolveWindow` rejects one that is past the end of the window.
    const resumeFrom = last === null || last <= end ? last ?? backfillStart : end;
    return { c, last, start: window.from ?? resumeFrom };
  });
  const ranged = plan.filter(p => p.c.rangeParams !== 'none');
  const isFirstSync = ranged.every(p => p.last === null);
  const startDate = ranged.map(p => p.start).sort()[0]!;

  _log(isFirstSync && window.from === undefined
    ? `First sync — backfilling the last ${BACKFILL_DAYS} days: ${startDate} → ${end}`
    : `Syncing ${startDate} → ${end}`);

  const fetched: Record<string, number> = {};
  const added: Record<string, number> = {};
  for (const { c, start } of plan) {
    const rows = await fetchCollection(client, c, start, end, tz);
    const stmt = db.query(insertSql(c));
    if (c.rangeParams === 'none') {
      // A snapshot is the whole truth: rows that disappeared upstream (a ring removed from the account)
      // disappear here too, and "new" means an id the table did not hold before.
      const pk = c.columns.find(col => col.pk)?.name;
      if (!pk) throw new Error(`Snapshot collection ${c.name} must declare a primary-key column (enforced by the registry tests).`);
      const ids = () => new Set((db.query(`SELECT ${pk} AS id FROM ${c.table}`).all() as { id: string }[]).map(r => r.id));
      const known = ids();
      db.transaction((rs: unknown[]) => {
        db.exec(`DELETE FROM ${c.table}`);
        for (const r of rs) stmt.run(...rowValues(c, r));
      })(rows);
      fetched[c.table] = rows.length;
      added[c.table] = [...ids()].filter(id => !known.has(id)).length;
      _log(`  + ${c.name} (${c.table}): ${rows.length} fetched, ${added[c.table]} new${rows.length === 0 ? ', table cleared' : ''}`);
      continue;
    }
    const before = rowCount(db, c.table);
    db.transaction((rs: unknown[]) => { for (const r of rs) stmt.run(...rowValues(c, r)); })(rows);
    fetched[c.table] = rows.length;
    added[c.table] = rowCount(db, c.table) - before;
    // Every collection gets a line, including the ones that returned nothing: a silent collection
    // was indistinguishable from a failed one, while the summary listed it anyway. Both names are
    // printed because the summary and `fetch` speak in collection names while `db stats` and the
    // schema speak in table names.
    _log(`  + ${c.name} (${c.table}): ${rows.length} fetched, ${added[c.table]} new`);
  }

  _log('Import complete.');
  return { startDate, endDate: end, fetched, added, isFirstSync };
}
