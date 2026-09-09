import type { Database } from './open.js';

/**
 * Whether a day's activity totals are final.
 *
 * The old rule inferred it: a day was complete once a *later* day had its own activity record, and
 * only if it was already before `today`. That reads the ring's behaviour rather than the day, and it
 * is wrong wherever the two come apart (#74):
 *
 * - a ring that stops uploading freezes the last day it did upload as "still accumulating" forever,
 *   so its steps stay out of every average and its score out of every pattern;
 * - a report timezone west of the ring's resolves `today` to a day the cache has already closed, and
 *   the `d < today` clause discards evidence the rule was holding;
 * - `completeThrough` could name a day with no activity row at all, so the note claimed to cover
 *   days the table never printed.
 *
 * Oura already answers the question directly. `class_5_min` carries one character per five-minute
 * slot, so a closed day has 288 of them and a day in progress has however many have elapsed —
 * verified live: 2026-09-07 and 09-08 returned 288, 09-09 returned 150 at half past twelve. `sync`
 * stores the length in `daily_activity.class_5_min_slots`, and completeness becomes a fact read off
 * the record instead of a guess about the ring. Neither `today` nor the timezone enters into it.
 *
 * Rows written before that column existed hold NULL, and those fall back to the old rule — a cache
 * fills in as `sync` re-fetches each day, and `sync --from` fills older days on demand.
 */

/** Five-minute slots in a whole day: 24 × 60 / 5. A `class_5_min` this long means the day is over. */
export const SLOTS_PER_DAY = 288;

export interface DayCompleteness {
  /** True when the day's activity totals are final. False for a day with no activity row at all. */
  isComplete(day: string): boolean;
  /** The newest of `days` that is complete, or null when none is — never a day without a record. */
  completeThrough(days: readonly string[]): string | null;
}

export function dayCompleteness(db: Database, today: string): DayCompleteness {
  const rows = db.query('SELECT day, class_5_min_slots AS slots FROM daily_activity')
    .all() as Array<{ day: string; slots: number | null }>;
  const slotsByDay = new Map(rows.map(r => [r.day, r.slots]));
  // Deliberately unbounded, as the old rule was: a record past the window still proves Oura moved on
  // from the days inside it. Only the fallback uses this.
  const newestDay = rows.reduce<string | null>((a, r) => (a === null || r.day > a ? r.day : a), null);

  const isComplete = (day: string): boolean => {
    if (!slotsByDay.has(day)) return false; // no record: nothing to call final
    const slots = slotsByDay.get(day) ?? null;
    if (slots !== null) return slots >= SLOTS_PER_DAY;
    // Pre-migration row. `day < today` stays in the fallback for the reason it was written: a record
    // dated after today (a wrong ring clock, a hand-made import) must not close today out.
    return day < today && newestDay !== null && newestDay > day;
  };

  return {
    isComplete,
    completeThrough: days => [...days].reverse().find(isComplete) ?? null,
  };
}
