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
 * The scope comes from the response, never from the request: only days the API actually described,
 * or the instants between its first and last sample, can lose rows. A window the API answered with
 * nothing is left alone.
 *
 * Planning happens before the inserts, so the plan can also say which rows are genuinely new;
 * the deletes happen after them, inside the caller's transaction.
 */

/** Columns that identify one row: the primary key, else the columns of the unique index. */
export function identityColumns(c: AnyCollection): readonly string[] {
  const pk = c.columns.filter(col => col.pk).map(col => col.name);
  if (pk.length > 0) return pk;
  const unique = c.columns.filter(col => col.unique).map(col => col.name);
  if (unique.length > 0) return unique;
  return (c.indexes ?? []).find(i => i.unique)?.columns ?? [];
}

/**
 * A response that drops most of a large window is not a correction, it is a truncated answer — a
 * rate-limited page, a partial read — and `INSERT OR IGNORE` never destroyed anything, so this
 * must not either. Both conditions have to hold before a removal is refused: it takes the
 * majority of the window *and* it is more than a handful of rows. Without the second, the ordinary
 * repair this exists for would be blocked, since a re-issued workout is one stale row out of one.
 */
const MAX_REMOVED_SHARE = 0.5;
const ALWAYS_SAFE_TO_REMOVE = 5;

export interface WindowPlan {
  /** Response rows whose identity the table did not already hold. */
  added: number;
  /**
   * Identity values of stored rows the response no longer contains, one array of column values per
   * row. Rows are addressed by identity rather than by rowid because the inserts run in between,
   * and `INSERT OR REPLACE` can hand a replaced row's rowid to a different record.
   */
  stale: SqlValue[][];
  /** Set instead of `stale` when the removal looked like a truncated response, for the caller to report. */
  refused?: number;
}

const EMPTY: WindowPlan = { added: 0, stale: [] };

function keyOf(values: readonly unknown[]): string {
  return values.map(v => String(v)).join(' ');
}

/**
 * What this response changes: how many of its rows are new, and which stored rows it drops.
 * Call before inserting; `applyWindowPlan` performs the deletes afterwards.
 */
export function planWindow(db: Database, c: AnyCollection, rows: readonly unknown[]): WindowPlan {
  const identity = identityColumns(c);
  if (rows.length === 0 || identity.length === 0) return EMPTY;

  const pickOf = (name: string) => c.columns.find(col => col.name === name)?.pick;
  const identityPicks = identity.map(pickOf);
  // The daily endpoints are scoped by the day they describe, the timeseries by the instant.
  const scope = c.rangeParams === 'datetime' ? 'timestamp' : 'day';
  const scopePick = pickOf(scope);
  if (scopePick === undefined || identityPicks.some(p => p === undefined)) return EMPTY;

  const keyFor = (row: unknown) => keyOf(identityPicks.map(pick => pick!(row)));
  const wanted = new Set(rows.map(keyFor));
  const scopeValues = rows.map(row => String(scopePick(row)));

  const [where, params] = scope === 'timestamp'
    ? [`${scope} BETWEEN ? AND ?`, [minOf(scopeValues), maxOf(scopeValues)]]
    : [(days => `${scope} IN (${days.map(() => '?').join(', ')})`)([...new Set(scopeValues)]), [...new Set(scopeValues)]];

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

  const added = [...wanted].filter(key => !storedKeys.has(key)).length;
  if (stale.length > ALWAYS_SAFE_TO_REMOVE && stale.length > stored.length * MAX_REMOVED_SHARE) {
    return { added, stale: [], refused: stale.length };
  }
  return { added, stale };
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
