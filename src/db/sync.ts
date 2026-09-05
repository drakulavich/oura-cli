import type { Database } from './open.js';
import type { OuraClient } from '../api/client.js';
import { COLLECTIONS, insertSql, rangeQuery, rowValues } from '../collections/index.js';
import { shiftDay } from '../lib/time.js';

const BACKFILL_DAYS = 30;
const FRESHNESS_TABLES = ['daily_sleep', 'daily_readiness', 'daily_activity'] as const;

export interface ImportResult {
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
  isFirstSync: boolean;
}

export interface SyncClock {
  /** YYYY-MM-DD in `tz` */
  today: string;
  tz: string;
}

export async function importDaily(
  db: Database, client: OuraClient, clock: SyncClock, log?: (msg: string) => void,
): Promise<ImportResult> {
  const { today, tz } = clock;
  const _log = log ?? (() => {});

  const lastDates: string[] = [];
  for (const tbl of FRESHNESS_TABLES) {
    const row = db.query(`SELECT MAX(day) as d FROM ${tbl}`).get() as { d: string | null };
    if (row?.d) lastDates.push(row.d);
  }
  const isFirstSync = lastDates.length === 0;
  const startDate = isFirstSync ? shiftDay(today, -BACKFILL_DAYS) : lastDates.sort()[0]!;

  _log(isFirstSync
    ? `First sync — backfilling the last ${BACKFILL_DAYS} days: ${startDate} → ${today}`
    : `Syncing ${startDate} → ${today}`);

  const counts: Record<string, number> = {};
  for (const c of COLLECTIONS) {
    const rows = await client.fetch<unknown>(c.endpoint, rangeQuery(c, startDate, today, tz));
    const stmt = db.query(insertSql(c));
    db.transaction((rs: unknown[]) => { for (const r of rs) stmt.run(...rowValues(c, r)); })(rows);
    counts[c.table] = rows.length;
    if (rows.length > 0) _log(`  + ${c.table}: ${rows.length} rows`);
  }

  _log('Import complete.');
  return { startDate, endDate: today, counts, isFirstSync };
}
