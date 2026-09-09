import type { Database } from './open.js';
import type { AnyCollection, SqlValue } from '../collections/index.js';

/**
 * Bring a re-fetched window in line with what the API returned.
 *
 * `sync` only ever inserted, which is right for a table keyed by day — the replace lands on the
 * same row — and wrong everywhere else. Oura reclassifies a heart-rate sample from `awake` to
 * `workout` and the old row stays beside the new one (#91); it re-issues a workout or a sleep
 * period under a new id and the cache keeps both, so a report averages one night twice (#71).
 *
 * Everything here is scoped by what the API said, never by what was asked of it, and scoped one
 * *request* at a time. A range wider than the endpoint allows is fetched in pieces, and a piece
 * that answers with nothing described nothing: its days must not be vouched for by its neighbours'
 * bounds, or one empty 200 in the middle of a long `--from` window takes every stored sample
 * between them with it.
 *
 * Planning happens before the inserts, so the plan can also say which rows are genuinely new;
 * the deletes happen after them, inside the caller's transaction.
 *
 * The pieces a range is split into are disjoint — `datetimeQueries` steps by a whole span and
 * `dateQueries` by whole days — which is why a piece may judge its own scope alone. Nothing here
 * depends on that holding: a row any piece returned is never stale, whichever piece's scope it
 * falls in.
 */

/**
 * Columns that identify one row of `c` for reconciliation.
 *
 * A UNIQUE column comes first, and for the daily summaries that is `day`: the table already holds
 * one row per day, so a day recomputed under a new id replaces its predecessor rather than joining
 * it. Keying those on `id` would count the recomputed day as new and then hunt for a stale row the
 * insert had already replaced. Everything else keys on the primary key, and the timeseries, which
 * have none, on the columns of their unique index.
 */
export function identityColumns(c: AnyCollection): readonly string[] {
  const unique = c.columns.filter(col => col.unique).map(col => col.name);
  if (unique.length > 0) return unique;
  const pk = c.columns.filter(col => col.pk).map(col => col.name);
  if (pk.length > 0) return pk;
  return (c.indexes ?? []).find(i => i.unique)?.columns ?? [];
}

/**
 * A piece whose answer drops most of what is stored for it is not a correction, it is a truncated
 * answer — a rate-limited page, a partial read — and inserting never destroyed anything, so this
 * must not either. Both conditions have to hold: the removal takes the majority of *that piece's*
 * scope, and it is more than a handful of rows. Judged per piece rather than per collection,
 * because a share of a month-wide window says nothing about one bad day inside it.
 *
 * The shapes are indistinguishable from here, so a genuine correction that large is refused on
 * every run and no narrower window escapes it — the scope is the returned rows' own bounds, so the
 * ratio is the same however the range is asked for (#100). `prune` is the way through: not a
 * better guess, but the user answering the question the guard cannot.
 */
const MAX_REMOVED_SHARE = 0.5;
const ALWAYS_SAFE_TO_REMOVE = 5;

/** Separates the parts of a composite identity; no id, timestamp or source contains it. */
const KEY_SEPARATOR = '\u0000';

export interface WindowPlan {
  /** Response rows whose identity the table did not already hold. */
  added: number;
  /**
   * Identity values of stored rows the response no longer contains, one array of column values per
   * row. Rows are addressed by identity rather than by rowid because the inserts run in between,
   * and `INSERT OR REPLACE` can hand a replaced row's rowid to a different record.
   */
  stale: SqlValue[][];
  /** Rows a piece dropped that were kept anyway, because that piece's answer looked truncated. */
  refused: number;
  /**
   * Rows in `stale` that only got there because `prune` was set — the guard would have refused
   * them. Counted so a pruning run can name what it went past instead of reporting it as ordinary
   * reconciliation; always 0 without the flag, when those rows land in `refused` instead.
   */
  bypassed: number;
}

export interface PlanOptions {
  /**
   * Apply removals the truncation guard would refuse. Per run and never stored: the guard is right
   * about the case it was built for, and this is the user vouching for one response it cannot
   * judge. With it set, `refused` is always 0 and `bypassed` carries the same rows instead.
   */
  prune?: boolean;
}

function emptyPlan(): WindowPlan {
  return { added: 0, stale: [], refused: 0, bypassed: 0 };
}

function keyOf(values: readonly unknown[]): string {
  return values.map(v => String(v)).join(KEY_SEPARATOR);
}

/**
 * What these responses change: how many of their rows are new, and which stored rows they drop.
 * `pieces` holds one array per request the range needed — see `fetchCollectionByPiece`.
 * Call before inserting; `applyWindowPlan` performs the deletes afterwards.
 */
export function planWindow(
  db: Database, c: AnyCollection, pieces: readonly (readonly unknown[])[], options: PlanOptions = {},
): WindowPlan {
  const identity = identityColumns(c);
  if (identity.length === 0) return emptyPlan();

  const pickOf = (name: string) => c.columns.find(col => col.name === name)?.pick;
  const identityPicks = identity.map(pickOf);
  // The daily endpoints are scoped by the day they describe, the timeseries by the instant.
  const scopeName = c.rangeParams === 'datetime' ? 'timestamp' : 'day';
  const scopePick = pickOf(scopeName);
  if (scopePick === undefined || identityPicks.some(p => p === undefined)) return emptyPlan();

  const keyFor = (row: unknown) => keyOf(identityPicks.map(pick => pick!(row)));
  // Every row the API returned anywhere in this range. Union rather than per piece: a row is not
  // stale because the piece whose scope it falls in happens not to be the piece that returned it.
  const wanted = new Set(pieces.flat().map(keyFor));
  const plan = emptyPlan();
  // One row, one verdict. Overlapping pieces would otherwise stage the same delete twice and
  // report a count larger than the removal it qualifies.
  const decided = new Set<string>();

  for (const piece of pieces) {
    if (piece.length === 0) continue; // described nothing, so it vouches for nothing
    // A null scope value would sort above every timestamp and widen the range to everything.
    const scopeValues = piece.map(row => scopePick(row)).filter(v => v !== null && v !== undefined).map(String);
    if (scopeValues.length === 0) continue;

    const days = [...new Set(scopeValues)];
    const [where, params] = c.rangeParams === 'datetime'
      ? [`${scopeName} BETWEEN ? AND ?`, [minOf(scopeValues), maxOf(scopeValues)]] as const
      : [`${scopeName} IN (${days.map(() => '?').join(', ')})`, days] as const;

    const stored = db.query(`SELECT ${identity.join(', ')} FROM ${c.table} WHERE ${where}`)
      .all(...(params as never[])) as Array<Record<string, SqlValue>>;

    const storedKeys = new Set<string>();
    const stale: SqlValue[][] = [];
    for (const row of stored) {
      const values = identity.map(name => row[name] ?? null);
      const key = keyOf(values);
      storedKeys.add(key);
      if (!wanted.has(key)) stale.push(values);
    }

    plan.added += [...new Set(piece.map(keyFor))].filter(key => !storedKeys.has(key)).length;
    // The ratio is judged on everything this piece dropped — that is what says whether its answer
    // looks truncated — while the counts below only take rows no earlier piece has decided.
    const looksTruncated = stale.length > ALWAYS_SAFE_TO_REMOVE && stale.length > stored.length * MAX_REMOVED_SHARE;
    const undecided = stale.filter(values => !decided.has(keyOf(values)));
    for (const values of undecided) decided.add(keyOf(values));
    if (looksTruncated && !options.prune) {
      plan.refused += undecided.length;
    } else {
      if (looksTruncated) plan.bypassed += undecided.length;
      plan.stale.push(...undecided);
    }
  }

  return plan;
}

/**
 * Delete the rows the plan found stale, and report how many rows actually went — not how many were
 * planned. A row can be gone already: on a table with a unique day, the insert that ran in between
 * replaced it, which is exactly the case where this must report nothing removed.
 */
export function applyWindowPlan(db: Database, c: AnyCollection, plan: WindowPlan): number {
  if (plan.stale.length === 0) return 0;
  const identity = identityColumns(c);
  const del = db.query(`DELETE FROM ${c.table} WHERE ${identity.map(name => `${name} IS ?`).join(' AND ')}`);
  let removed = 0;
  for (const values of plan.stale) removed += del.run(...(values as never[])).changes;
  return removed;
}

function minOf(values: readonly string[]): string {
  return values.reduce((a, b) => (b < a ? b : a));
}

function maxOf(values: readonly string[]): string {
  return values.reduce((a, b) => (b > a ? b : a));
}
