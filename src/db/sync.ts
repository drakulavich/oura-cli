import type { Database } from './open.js';
import type { OuraClient } from '../api/client.js';
import { COLLECTIONS, fetchCollectionByPiece, hasIdentity, identityColumns, insertSql, rowValues } from '../collections/index.js';
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
   * reclassified, a workout re-issued under a new id, a ring no longer in the account. Only tables
   * that lost rows appear.
   */
  removed: Record<string, number>;
  /**
   * Rows per table the API returned without an identity field (a heart-rate sample with a null
   * `timestamp`), dropped before insert because nothing could store or reconcile them. Only tables
   * that lost rows this way appear. Counted in `fetched`, never in `added`.
   */
  dropped: Record<string, number>;
  /**
   * Rows per table that the API did not return but that were kept anyway, because dropping them
   * would have taken most of what one request described — the shape of a truncated response. For a
   * snapshot collection that is an empty response against a table with rows. (A response whose every
   * row was dropped for lacking its identity also leaves the table alone, but is reported under
   * `dropped` only: there is no correction for `--prune` to apply.)
   * A non-empty value means the cache is knowingly out of step with the API for those rows. It is
   * the safe direction, and it is not self-healing — a genuine correction that large is refused on
   * every run — so `sync --prune` applies them once the user has decided which shape it was.
   * Always empty when that flag was passed.
   */
  refused: Record<string, RefusalRecord>;
  /**
   * Rows per table this run removed that the guard would otherwise have refused — the effect of
   * `--prune`, reported apart from `removed` so a bypass is never indistinguishable from ordinary
   * reconciliation. Always empty without the flag, and empty for a collection the flag did not name.
   */
  pruned: Record<string, RefusalRecord>;
  /**
   * What `--prune` was asked to cover, when it was passed at all. Recorded because the text output
   * announces the bypass before the collection lines and the JSON otherwise could not: with nothing
   * actually pruned the two payloads were byte-identical, so a kept log could not say whether the
   * guard had been lifted.
   */
  pruneScope?: 'all' | readonly string[];
  /** True when every table was empty before this run. */
  isFirstSync: boolean;
}

/**
 * A count plus the name `--prune` takes for it. `fetched`/`added`/`removed` stay bare counts keyed
 * by table, as they always were; these two carry the collection name because they are the ones a
 * reader has to act on, and nothing else in the published output maps a table back to a collection.
 */
export interface RefusalRecord {
  rows: number;
  /** The collection name, i.e. what to pass to `--prune`. */
  collection: string;
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

export interface SyncOptions {
  /**
   * Which collections may go past the truncation guard this run — `'all'` for a bare `--prune`,
   * or the collection names `--prune=hr,workout` listed. Kept apart from the window because
   * narrowing the window is not an alternative to it: the guard measures a piece against its own
   * returned rows, so the ratio it refuses on does not move however the range is asked for.
   *
   * Scoped rather than a plain boolean because consent is per collection. The user reaches for this
   * after reading one collection's refusal; a run-wide flag would also lift the guard on every
   * other collection, and a genuinely truncated response for one of those would be deleted on the
   * strength of a decision that was never about it. Behind `--from` that loss does not come back:
   * the next ordinary sync starts from the watermark and never revisits the older window.
   */
  prune?: 'all' | readonly string[];
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
  options: SyncOptions = {},
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
  // Say it before the collection lines rather than after: the run that bypasses the guard should be
  // recognisable as such in the output someone kept, not only by the removals it went on to make.
  if (options.prune !== undefined) {
    const scope = options.prune === 'all' ? 'every collection' : options.prune.join(', ');
    _log(`--prune: applying removals even where a response looks truncated (${scope})`);
  }

  const fetched: Record<string, number> = {};
  const added: Record<string, number> = {};
  const removed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const refused: Record<string, RefusalRecord> = {};
  const pruned: Record<string, RefusalRecord> = {};
  const mayPrune = (name: string) => options.prune === 'all' || (options.prune?.includes(name) ?? false);
  for (const { c, start } of plan) {
    const returned = await fetchCollectionByPiece(client, c, start, end, tz);
    // A row without its identity cannot be keyed, and its picks may throw; drop it here and say so.
    const pieces = returned.map(piece => piece.filter(r => hasIdentity(c, r)));
    const rows = pieces.flat();
    const missing = returned.flat().length - rows.length;
    if (missing > 0) dropped[c.table] = missing;
    const droppedTail = missing > 0 ? `, ${missing} dropped (no ${identityColumns(c).join('/')})` : '';
    const stmt = db.query(insertSql(c));
    if (c.rangeParams === 'none') {
      // A snapshot is the whole truth: rows that disappeared upstream (a ring removed from the account)
      // disappear here too, and "new" means an id the table did not hold before. With one exception,
      // the same one planWindow makes for an empty piece: an empty 200 describes nothing, so it must
      // not clear a table that has rows (#105). A ring genuinely removed leaves the account with zero
      // rings, which looks identical from here; `--prune=ring` is how the user says which it was.
      const pk = c.columns.find(col => col.pk)?.name;
      if (!pk) throw new Error(`Snapshot collection ${c.name} must declare a primary-key column (enforced by the registry tests).`);
      const ids = () => new Set((db.query(`SELECT ${pk} AS id FROM ${c.table}`).all() as { id: string }[]).map(r => r.id));
      const known = ids();
      // Nothing storable arrived. If rows did arrive and were all dropped, that is not an empty answer
      // and there is no correction for --prune to apply: the table is left alone, `dropped` says why,
      // and `refused` stays clear so it keeps its one meaning, "kept, and --prune would apply it".
      const unstorable = rows.length === 0 && missing > 0;
      const refuse = rows.length === 0 && known.size > 0 && (unstorable || !mayPrune(c.name));
      if (!refuse) {
        db.transaction((rs: unknown[]) => {
          db.exec(`DELETE FROM ${c.table}`);
          for (const r of rs) stmt.run(...rowValues(c, r));
        })(rows);
      }
      const now = ids();
      const gone = [...known].filter(id => !now.has(id)).length;
      fetched[c.table] = rows.length + missing;
      added[c.table] = [...now].filter(id => !known.has(id)).length;
      if (gone > 0) removed[c.table] = gone;
      if (refuse && !unstorable) refused[c.table] = { rows: known.size, collection: c.name };
      else if (rows.length === 0 && gone > 0) pruned[c.table] = { rows: gone, collection: c.name };
      const tail = gone > 0 ? `, ${gone} stale removed${pruned[c.table] ? ' (past the truncation guard)' : ''}` : '';
      const kept = !refuse ? ''
        : unstorable ? `, ${known.size} rows kept: the response held no storable rows`
        : `, ${known.size} rows kept that the API did not return — an empty answer describes nothing; re-run with --prune=${c.name} to apply it`;
      _log(`  + ${c.name} (${c.table}): ${fetched[c.table]} fetched, ${added[c.table]} new${droppedTail}${tail}${kept}`);
      continue;
    }
    // Insert and reconcile in one transaction: the window ends up holding exactly what the API
    // returned for it, and a failure part-way leaves it as it was. Immediate, not deferred: the
    // plan reads before the first insert writes, and a deferred transaction that takes its read
    // snapshot first fails with SQLITE_BUSY_SNAPSHOT — which busy_timeout does not retry — when
    // another sync commits in between.
    const { windowPlan, gone } = db.transaction((ps: unknown[][]) => {
      const windowPlan: WindowPlan = planWindow(db, c, ps, { prune: mayPrune(c.name) });
      for (const piece of ps) for (const r of piece) stmt.run(...rowValues(c, r));
      return { windowPlan, gone: applyWindowPlan(db, c, windowPlan) };
    }).immediate(pieces);
    fetched[c.table] = rows.length + missing;
    added[c.table] = windowPlan.added;
    if (gone > 0) removed[c.table] = gone;
    if (windowPlan.refused > 0) refused[c.table] = { rows: windowPlan.refused, collection: c.name };
    if (windowPlan.bypassed > 0) pruned[c.table] = { rows: windowPlan.bypassed, collection: c.name };
    // Every collection gets a line, including the ones that returned nothing: a silent collection
    // was indistinguishable from a failed one, while the summary listed it anyway. Both names are
    // printed because the summary and `fetch` speak in collection names while `db stats` and the
    // schema speak in table names.
    // A bypass is named on its own line's tail: "12 stale removed" alone reads like any other
    // reconciliation, and under --from those rows do not come back on the next sync.
    const tail = gone > 0
      ? `, ${gone} stale removed${windowPlan.bypassed > 0 ? ` (${windowPlan.bypassed} past the truncation guard)` : ''}`
      : '';
    // Still not a diagnosis — the guard cannot tell a truncated response from a genuine large
    // correction, and only the user can. But there is now something to do about it either way, and
    // naming it here is the only place the situation is visible.
    const kept = windowPlan.refused > 0
      ? `, ${windowPlan.refused} rows kept that the API did not return — too many to drop on one response; re-run with --prune=${c.name} to apply them`
      : '';
    _log(`  + ${c.name} (${c.table}): ${fetched[c.table]} fetched, ${added[c.table]} new${droppedTail}${tail}${kept}`);
  }

  _log('Import complete.');
  return { startDate, endDate: end, fetched, added, removed, dropped, refused, pruned, isFirstSync,
    ...(options.prune === undefined ? {} : { pruneScope: options.prune }) };
}
