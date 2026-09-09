import type { Database } from './open.js';
import type { OuraClient } from '../api/client.js';
import { COLLECTIONS, fetchCollectionByPiece, insertSql, rowValues } from '../collections/index.js';
import { shiftDay } from '../lib/time.js';
import { planWindow, applyWindowPlan, type WindowPlan } from './reconcile.js';

/** Days (inclusive) a collection's first sync covers. */
export const BACKFILL_DAYS = 30;

export interface ImportResult {
  /**
   * Earliest day the cache needed across collections — its oldest watermark, or the backfill
   * start. A collection that re-walks its own tail (`syncLookbackDays`, currently `hr`) requests
   * days before this; that is a re-read of days already stored, not a wider window.
   */
  startDate: string;
  endDate: string;
  /** Rows the API returned, per table. */
  fetched: Record<string, number>;
  /**
   * Rows in the response whose identity the table did not already hold, per table. A re-fetched
   * row counts as fetched, not as new — including a day recomputed under a new id, which replaces
   * the row it supersedes rather than joining it.
   */
  added: Record<string, number>;
  /**
   * Rows deleted per table because the API no longer has them: a heart-rate sample Oura
   * reclassified, a workout re-issued under a new id. Only tables that lost rows appear.
   */
  removed: Record<string, number>;
  /**
   * Rows per table that the API did not return but that were kept anyway, because dropping them
   * would have taken most of what one request described — the shape of a truncated response.
   * A non-empty value means the cache is knowingly out of step with the API for those rows. It is
   * the safe direction, but it is not self-healing: a genuine correction that large keeps being
   * refused on every run (#100).
   */
  refused: Record<string, number>;
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

/**
 * The newest stored day at or before `end`. Rows dated after the window are ignored on purpose:
 * a collection whose `day` is a day the user chose (a tag, a rest-mode period, a session) can hold
 * a day in the future, and taking the plain MAX would invert the range — which `rangeQueries`
 * answers with no queries at all, so the collection would silently stop syncing for good. The same
 * inversion happens for a day whenever the resolved timezone is west of the one the cache was
 * built in (a travelling laptop, OURA_TZ, --tz).
 */
function lastDay(db: Database, table: string, end: string): string | null {
  return (db.query(`SELECT MAX(day) AS d FROM ${table} WHERE day <= ?`).get(end) as { d: string | null }).d;
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
    const last = c.rangeParams === 'none' ? null : lastDay(db, c.table, end);
    // Where the cache says this collection has to resume from...
    const resume = window.from ?? last ?? backfillStart;
    // ...and how far behind that the request actually reaches: Oura backfills some collections
    // days late, and a day left behind the watermark is never revisited. An explicit --from
    // replaces both.
    const start = window.from ?? shiftDay(resume, -(last === null ? 0 : c.syncLookbackDays ?? 0));
    return { c, last, resume, start };
  });
  const ranged = plan.filter(p => p.c.rangeParams !== 'none');
  const isFirstSync = ranged.every(p => p.last === null);
  // Reported from `resume`, not `start`: a lookback is one collection re-reading its own tail,
  // and quoting it here would tell a user that every sync covers a fortnight of daily summaries.
  const startDate = ranged.map(p => p.resume).sort()[0]!;

  _log(isFirstSync && window.from === undefined
    ? `First sync — backfilling the last ${BACKFILL_DAYS} days: ${startDate} → ${end}`
    : `Syncing ${startDate} → ${end}`);

  const fetched: Record<string, number> = {};
  const added: Record<string, number> = {};
  const removed: Record<string, number> = {};
  const refused: Record<string, number> = {};
  for (const { c, start } of plan) {
    const pieces = await fetchCollectionByPiece(client, c, start, end, tz);
    const rows = pieces.flat();
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
    // Insert and reconcile in one transaction: the window ends up holding exactly what the API
    // returned for it, and a failure part-way leaves it as it was. Immediate, not deferred: the
    // plan reads before the first insert writes, and a deferred transaction that takes its read
    // snapshot first fails with SQLITE_BUSY_SNAPSHOT — which busy_timeout does not retry — when
    // another sync commits in between.
    const { windowPlan, gone } = db.transaction((ps: unknown[][]) => {
      const windowPlan: WindowPlan = planWindow(db, c, ps);
      for (const piece of ps) for (const r of piece) stmt.run(...rowValues(c, r));
      return { windowPlan, gone: applyWindowPlan(db, c, windowPlan) };
    }).immediate(pieces);
    fetched[c.table] = rows.length;
    added[c.table] = windowPlan.added;
    if (gone > 0) removed[c.table] = gone;
    if (windowPlan.refused > 0) refused[c.table] = windowPlan.refused;
    // Every collection gets a line, including the ones that returned nothing: a silent collection
    // was indistinguishable from a failed one, while the summary listed it anyway. Both names are
    // printed because the summary and `fetch` speak in collection names while `db stats` and the
    // schema speak in table names.
    const tail = gone > 0 ? `, ${gone} stale removed` : '';
    // Deliberately not a diagnosis: the guard cannot tell a truncated response from a genuine
    // large correction, and it must not send the user after a fix that would not work for the
    // second. Keeping the rows is the safe direction, so say plainly what was kept and why.
    const kept = windowPlan.refused > 0
      ? `, ${windowPlan.refused} rows kept that the API did not return — too many to drop on one response, so they stay`
      : '';
    _log(`  + ${c.name} (${c.table}): ${rows.length} fetched, ${added[c.table]} new${tail}${kept}`);
  }

  _log('Import complete.');
  return { startDate, endDate: end, fetched, added, removed, refused, isFirstSync };
}
