import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { dayCompleteness, SLOTS_PER_DAY } from './day-complete.js';

const TODAY = '2026-06-15';

function seeded(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

/** `slots` undefined writes NULL, the shape of every row stored before the column existed. */
function activity(db: Database, day: string, slots?: number): void {
  db.query('INSERT INTO daily_activity (id, day, score, steps, class_5_min_slots) VALUES (?,?,?,?,?)')
    .run(`a-${day}`, day, 70, 5000, slots ?? null);
}

describe('dayCompleteness', () => {
  it('reads the day off its own slot count', () => {
    const db = seeded();
    activity(db, '2026-06-13', SLOTS_PER_DAY);
    activity(db, '2026-06-14', 150);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2026-06-13')).toBe(true);
    expect(c.isComplete('2026-06-14')).toBe(false);
  });

  it('closes the newest day when it is full, even though nothing follows it', () => {
    // The quiet ring (#74). The old rule needed a *later* record, so the last day a stopped ring
    // uploaded stayed "still accumulating" forever and its steps never entered an average.
    const db = seeded();
    activity(db, '2026-06-03', SLOTS_PER_DAY);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2026-06-03')).toBe(true);
  });

  it('does not care what today is when the day says it is over', () => {
    // A report timezone west of the ring's resolves `today` to a day the cache has already closed;
    // the old rule's `d < today` clause discarded evidence it was already holding (#74).
    const db = seeded();
    activity(db, '2026-06-15', SLOTS_PER_DAY);

    const c = dayCompleteness(db, '2026-06-15');
    db.close();
    expect(c.isComplete('2026-06-15')).toBe(true);
  });

  it('calls a day with no record at all incomplete, so completeThrough never names one', () => {
    const db = seeded();
    activity(db, '2026-06-12', SLOTS_PER_DAY);

    const c = dayCompleteness(db, TODAY);
    const through = c.completeThrough('2026-06-12', '2026-06-14');
    db.close();
    expect(c.isComplete('2026-06-13')).toBe(false);
    expect(through).toBe('2026-06-12'); // not 06-14, which is over but holds nothing
  });

  it('falls back to the next-day rule for rows written before the column existed', () => {
    // An existing cache has NULL here until a sync re-fetches each day, so the old heuristic has to
    // keep working meanwhile — otherwise upgrading would silently blank every average.
    const db = seeded();
    activity(db, '2026-06-13');
    activity(db, '2026-06-14');

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2026-06-13')).toBe(true);  // a later record exists
    expect(c.isComplete('2026-06-14')).toBe(false); // newest, nothing follows it
  });

  it('keeps the guard against a record dated after today in the fallback', () => {
    // A ring with a wrong clock, or a hand-made import, must not close today out.
    const db = seeded();
    activity(db, TODAY);
    activity(db, '2026-06-16');

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete(TODAY)).toBe(false);
  });

  it('reads a short slot count as no answer, not as evidence the day is open', () => {
    // The rule this file got wrong first time round. 288 slots prove a day closed; anything less
    // proves nothing either way, so it has to defer to the next-day rule rather than return false.
    // 06-13 is short but has a later record, so it is over.
    const db = seeded();
    activity(db, '2026-06-13', 150);
    activity(db, '2026-06-14', SLOTS_PER_DAY);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2026-06-13')).toBe(true);
    expect(c.isComplete('2026-06-14')).toBe(true);
  });

  it('closes a short day that a timezone shift cut, when a later day follows it', () => {
    // Not hypothetical: a day's span is timestamp(d+1) - timestamp(d), so travelling east shortens
    // it. 2023-12-15 came back from the API with 276 slots and 13,637 steps, 2024-01-13 with 270
    // and 15,736 - both closed years ago. Under a rule that read `< 288` as "still accumulating"
    // they stayed partial forever, which is #74's own bug.
    const db = seeded();
    activity(db, '2023-12-15', 276);
    activity(db, '2023-12-16', SLOTS_PER_DAY);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2023-12-15')).toBe(true);
  });

  it('still calls a short day open when nothing follows it', () => {
    // The other side of the same rule: without a later record there is no evidence either way, and
    // the safe answer for the newest day is that it may still be accumulating.
    const db = seeded();
    activity(db, '2026-06-14', 276);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2026-06-14')).toBe(false);
  });

  it('keeps completeThrough inside the range it was given', () => {
    const db = seeded();
    activity(db, '2026-06-08', SLOTS_PER_DAY);
    activity(db, '2026-06-13', SLOTS_PER_DAY);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.completeThrough('2026-06-09', '2026-06-14')).toBe('2026-06-13');
    expect(c.completeThrough('2026-06-09', '2026-06-12')).toBeNull(); // 06-13 is past the end
    expect(c.completeThrough('2026-06-01', '2026-06-12')).toBe('2026-06-08');
  });
});
