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
 * Oura answers half the question directly. `class_5_min` carries one character per five-minute slot,
 * so a day that reports 288 of them has been closed out — verified live: 2026-09-07 and 09-08
 * returned 288, 09-09 returned 150 at half past twelve. `sync` stores the length in
 * `daily_activity.class_5_min_slots`.
 *
 * Only half, because the converse does not hold: a count *below* 288 is not evidence that a day is
 * still open. A day's span is `timestamp(d+1) − timestamp(d)`, so travelling east shortens it —
 * 2023-12-15 came back with 276 slots and 13,637 steps, 2024-01-13 with 270 and 15,736, both long
 * closed. (The count is not a clock either way: 288 also came back for 23-hour days, and long days
 * are capped at it.) So the slot count is read as positive evidence of closure and never as evidence
 * of openness: a day short of 288 falls back to the old next-day rule rather than being called open,
 * which is also what keeps rows written before the column existed — they hold NULL — working while a
 * cache fills in. Over the author's 1043 stored days the two rules together name exactly the same
 * days as the old rule alone, plus the quiet ring's last day; upgrading never makes a day *less*
 * complete than it was.
 */

/** Five-minute slots in a whole day: 24 × 60 / 5. A `class_5_min` this long means the day is over. */
export const SLOTS_PER_DAY = 288;

export interface DayCompleteness {
  /** True when the day's activity totals are final. False for a day with no activity row at all. */
  isComplete(day: string): boolean;
  /**
   * The newest complete day in `[start, end]`, or null when there is none. Never a day without an
   * activity record. Scans the days the table actually holds rather than the calendar range, so an
   * unbounded window (`db stats` asks for 99999 days) costs the same as a week.
   */
  completeThrough(start: string, end: string): string | null;
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
    // A full day of slots settles it on its own — no later record needed, and `today` does not enter
    // into it. Anything short of that is not an answer, so it falls through rather than returning.
    if ((slotsByDay.get(day) ?? 0) >= SLOTS_PER_DAY) return true;
    // Short, or a pre-migration NULL. `day < today` stays in the fallback for the reason it was
    // written: a record dated after today (a wrong ring clock, a hand-made import) must not close
    // today out.
    return day < today && newestDay !== null && newestDay > day;
  };

  // Descending, so the first hit is the newest. Only a day with a record can ever be complete, so
  // walking the records is equivalent to walking the calendar range — and bounded by the cache.
  const daysDesc = rows.map(r => r.day).sort().reverse();

  return {
    isComplete,
    completeThrough: (start, end) => daysDesc.find(d => d >= start && d <= end && isComplete(d)) ?? null,
  };
}
