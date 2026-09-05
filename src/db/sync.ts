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
  const plan = COLLECTIONS.map(c => {
    const last = lastDay(db, c.table);
    return { c, last, start: window.from ?? last ?? backfillStart };
  });
  const isFirstSync = plan.every(p => p.last === null);
  const startDate = plan.map(p => p.start).sort()[0]!;

  _log(isFirstSync && window.from === undefined
    ? `First sync — backfilling the last ${BACKFILL_DAYS} days: ${startDate} → ${end}`
    : `Syncing ${startDate} → ${end}`);

  const fetched: Record<string, number> = {};
  const added: Record<string, number> = {};
  for (const { c, start } of plan) {
    const rows = await fetchCollection(client, c, start, end, tz);
    const before = rowCount(db, c.table);
    const stmt = db.query(insertSql(c));
    db.transaction((rs: unknown[]) => { for (const r of rs) stmt.run(...rowValues(c, r)); })(rows);
    fetched[c.table] = rows.length;
    added[c.table] = rowCount(db, c.table) - before;
    if (rows.length > 0) _log(`  + ${c.table}: ${rows.length} fetched, ${added[c.table]} new`);
  }

  _log('Import complete.');
  return { startDate, endDate: end, fetched, added, isFirstSync };
}
