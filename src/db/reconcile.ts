import type { Database } from './open.js';
import { identityColumns, type AnyCollection, type Piece, type SqlValue } from '../collections/index.js';

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

/**
 * Whether a scope value lies inside the range a piece's request asked for. Instants are compared as
 * parsed times, because the request is written `…Z` and Oura writes `…+00:00`; days compare as text.
 * A missing bound, an empty string or an unparsable value is outside every range.
 */
function requestedRange(c: AnyCollection, query: Record<string, string>): (value: string) => boolean {
  if (c.rangeParams === 'datetime') {
    const from = Date.parse(query.start_datetime ?? '');
    const to = Date.parse(query.end_datetime ?? '');
    return value => { const t = Date.parse(value); return t >= from && t <= to; }; // NaN fails both
  }
  const from = query.start_date;
  const to = query.end_date;
  return value => from !== undefined && to !== undefined && value >= from && value <= to;
}

function keyOf(values: readonly unknown[]): string {
  return values.map(v => String(v)).join(KEY_SEPARATOR);
}

/**
 * What these responses change: how many of their rows are new, and which stored rows they drop.
 * `pieces` holds one entry per request the range needed, each with the query it sent — see
 * `fetchCollectionByPiece`. A piece's scope is clipped to what its query asked for: a row the API
 * returned from outside that window is still inserted, but it does not widen the scope over stored
 * rows the request never covered (#111). A piece whose query carries no bounds vouches for nothing.
 * Call before inserting; `applyWindowPlan` performs the deletes afterwards.
 */
export function planWindow(
  db: Database, c: AnyCollection, pieces: readonly Piece[], options: PlanOptions = {},
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
  const wanted = new Set(pieces.flatMap(p => p.rows).map(keyFor));
  const plan = emptyPlan();

  // Judge every piece before deciding any row. Two pieces whose returned bounds overlap can cover
  // the same stale row and disagree about whether their own answer looks truncated, so a verdict
  // taken as pieces are walked would be settled by whichever came first — the same responses in a
  // different order deleting a row instead of keeping it.
  const judged = pieces.map(piece => {
    if (piece.rows.length === 0) return null; // described nothing, so it vouches for nothing
    // Only values inside the request count towards the scope. A null would sort above every
    // timestamp; an empty string or a stray early sample sorts below every stored one, and a scope
    // taken from the returned bounds then reached back over the whole table: one such value made
    // 59 of 60 stored samples look stale (#111).
    const inRequested = requestedRange(c, piece.query);
    const scopeValues = piece.rows.map(row => scopePick(row))
      .filter(v => v !== null && v !== undefined).map(String).filter(inRequested);
    if (scopeValues.length === 0) return null;

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
    // The ratio is judged on everything this piece dropped: that is what says whether its own
    // answer looks truncated, independently of what any other piece said.
    const looksTruncated = stale.length > ALWAYS_SAFE_TO_REMOVE && stale.length > stored.length * MAX_REMOVED_SHARE;
    const fresh = [...new Set(piece.rows.map(keyFor))].filter(key => !storedKeys.has(key));
    return { stale, looksTruncated, fresh };
  });

  // Protection is the safe direction, so one doubting piece is enough: a row any covering piece
  // would have kept is kept, whichever order the pieces arrive in.
  const doubted = new Set<string>();
  for (const p of judged) {
    if (p?.looksTruncated) for (const values of p.stale) doubted.add(keyOf(values));
  }

  // One row, one verdict. Overlapping pieces would otherwise stage the same delete twice and
  // report a count larger than the removal it qualifies — and count one arriving row as two new.
  const countedNew = new Set<string>();
  const countedStale = new Set<string>();
  for (const p of judged) {
    if (p === null) continue;
    for (const key of p.fresh) {
      if (countedNew.has(key)) continue;
      countedNew.add(key);
      plan.added += 1;
    }
    for (const values of p.stale) {
      const key = keyOf(values);
      if (countedStale.has(key)) continue;
      countedStale.add(key);
      if (doubted.has(key) && !options.prune) {
        plan.refused += 1;
      } else {
        if (doubted.has(key)) plan.bypassed += 1;
        plan.stale.push(values);
      }
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
