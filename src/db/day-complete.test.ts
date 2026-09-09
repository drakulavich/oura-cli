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
    const through = c.completeThrough(['2026-06-12', '2026-06-13', '2026-06-14']);
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

  it('prefers the slot count over the fallback when both could answer', () => {
    // 06-13 has a later record, so the fallback would call it complete; its own slots say otherwise.
    const db = seeded();
    activity(db, '2026-06-13', 150);
    activity(db, '2026-06-14', SLOTS_PER_DAY);

    const c = dayCompleteness(db, TODAY);
    db.close();
    expect(c.isComplete('2026-06-13')).toBe(false);
    expect(c.isComplete('2026-06-14')).toBe(true);
  });
});
