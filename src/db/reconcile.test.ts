import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { planWindow, applyWindowPlan, type PlanOptions } from './reconcile.js';
import { identityColumns } from '../collections/index.js';
import { byName, insertSql, rowValues, type AnyCollection } from '../collections/index.js';

const hr = byName('hr')!;
const workout = byName('workout')!;
const sleep = byName('sleep')!;

function seeded(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

/** What `sync` does for one collection: plan, insert, delete — all in one transaction. */
function syncPieces(db: Database, c: AnyCollection, pieces: unknown[][], options: PlanOptions = {}): { added: number; removed: number; refused: number; bypassed: number } {
  const stmt = db.query(insertSql(c));
  const plan = planWindow(db, c, pieces, options);
  for (const row of pieces.flat()) stmt.run(...rowValues(c, row));
  return { added: plan.added, removed: applyWindowPlan(db, c, plan), refused: plan.refused, bypassed: plan.bypassed };
}

/** The common case: a range small enough to need one request. */
function syncWindow(db: Database, c: AnyCollection, rows: unknown[], options: PlanOptions = {}): { added: number; removed: number; refused: number; bypassed: number } {
  return syncPieces(db, c, [rows], options);
}

const sample = (minute: number, source: string) => ({
  timestamp: `2026-09-01T10:${String(minute).padStart(2, '0')}:00+00:00`, bpm: 60 + minute, source,
});

describe('identityColumns', () => {
  it('takes the primary key when a table has no unique column', () => {
    expect(identityColumns(workout)).toEqual(['id']);
  });

  it('prefers the unique day, so a summary recomputed under a new id is not counted as new', () => {
    expect(identityColumns(sleep)).toEqual(['day']);
  });

  it('falls back to the unique index, which is what the timeseries have', () => {
    expect(identityColumns(hr)).toEqual(['timestamp', 'source']);
  });
});

describe('a heart-rate sample Oura reclassifies', () => {
  it('leaves one row for the instant, not two', () => {
    // #91: awake → workout keeps the same timestamp, and the unique index is (timestamp, source),
    // so INSERT OR IGNORE added the new row and nothing removed the old one.
    const db = seeded();
    syncWindow(db, hr, [sample(0, 'awake'), sample(1, 'awake'), sample(2, 'rest')]);

    const result = syncWindow(db, hr, [sample(0, 'workout'), sample(1, 'awake'), sample(2, 'rest')]);

    const rows = db.query('SELECT timestamp, source FROM heartrate ORDER BY timestamp').all() as Array<{ timestamp: string; source: string }>;
    db.close();
    expect(rows.map(r => r.source)).toEqual(['workout', 'awake', 'rest']);
    expect(result).toEqual({ added: 1, removed: 1, refused: 0, bypassed: 0 });
  });

  it('does not touch samples outside the span the response covers', () => {
    const db = seeded();
    syncWindow(db, hr, [sample(0, 'awake'), sample(5, 'awake'), sample(9, 'awake')]);

    // A later run whose response covers only the middle of the stored range.
    const result = syncWindow(db, hr, [sample(5, 'workout')]);

    const rows = db.query('SELECT timestamp, source FROM heartrate ORDER BY timestamp').all() as Array<{ source: string }>;
    db.close();
    expect(rows.map(r => r.source)).toEqual(['awake', 'workout', 'awake']);
    expect(result.removed).toBe(1);
  });

  it('changes nothing when the API returns the same samples again', () => {
    const db = seeded();
    const rows = [sample(0, 'awake'), sample(1, 'rest')];
    syncWindow(db, hr, rows);

    const result = syncWindow(db, hr, rows);

    const count = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result).toEqual({ added: 0, removed: 0, refused: 0, bypassed: 0 });
    expect(count).toBe(2);
  });
});

describe('a day whose records are re-issued under new ids', () => {
  const workoutRow = (id: string, day: string) => ({ id, day, activity: 'walking', intensity: 'easy',
    start_datetime: `${day}T08:00:00+00:00`, end_datetime: `${day}T09:00:00+00:00`, calories: 100, distance: 1000, label: null, source: 'manual' });

  it('keeps only the records the API still has for that day', () => {
    // #71: workouts, sleep periods, sessions, rest-mode periods and tags key on id with a
    // non-unique day, so a re-issued record left both rows and a report averaged the day twice.
    const db = seeded();
    syncWindow(db, workout, [workoutRow('w1', '2026-09-05'), workoutRow('w2', '2026-09-05')]);

    const result = syncWindow(db, workout, [workoutRow('w1', '2026-09-05'), workoutRow('w3', '2026-09-05')]);

    const ids = (db.query('SELECT id FROM workouts ORDER BY id').all() as Array<{ id: string }>).map(r => r.id);
    db.close();
    expect(ids).toEqual(['w1', 'w3']);
    expect(result).toEqual({ added: 1, removed: 1, refused: 0, bypassed: 0 });
  });

  it('leaves days the response did not mention alone', () => {
    const db = seeded();
    syncWindow(db, workout, [workoutRow('w1', '2026-09-04'), workoutRow('w2', '2026-09-05')]);

    syncWindow(db, workout, [workoutRow('w3', '2026-09-05')]);

    const ids = (db.query('SELECT id FROM workouts ORDER BY id').all() as Array<{ id: string }>).map(r => r.id);
    db.close();
    expect(ids).toEqual(['w1', 'w3']); // 2026-09-04 untouched, 2026-09-05 replaced
  });

  it('is a no-op for a table with a unique day, where the insert already replaces', () => {
    const db = seeded();
    const daily = (id: string) => ({ id, day: '2026-09-05', score: 80, timestamp: '2026-09-05T00:00:00+00:00',
      contributors: {}, total_sleep_duration: null, deep_sleep_duration: null, rem_sleep_duration: null, average_hrv: null, lowest_heart_rate: null, efficiency: null });
    syncWindow(db, sleep, [daily('s1')]);

    const result = syncWindow(db, sleep, [daily('s2')]);

    const ids = (db.query('SELECT id FROM daily_sleep').all() as Array<{ id: string }>).map(r => r.id);
    db.close();
    expect(ids).toEqual(['s2']);
    expect(result.removed).toBe(0); // the unique day made the insert replace it
  });
});

describe('a range fetched in several pieces', () => {
  it('leaves the days of a piece that answered with nothing', () => {
    // The data-loss path: a piece returning HTTP 200 with an empty array sits between two pieces
    // that did return rows, so a scope taken across the whole collection bracketed its days and
    // deleted every stored sample in them.
    const db = seeded();
    const early = [sample(0, 'awake'), sample(1, 'awake')];
    const middle = [sample(4, 'awake'), sample(5, 'awake')];
    const late = [sample(8, 'awake'), sample(9, 'awake')];
    syncPieces(db, hr, [early, middle, late]);

    const result = syncPieces(db, hr, [early, [], late]);

    const stored = (db.query('SELECT timestamp FROM heartrate ORDER BY timestamp').all() as Array<{ timestamp: string }>).length;
    db.close();
    expect(stored).toBe(6); // the middle piece described nothing, so it removed nothing
    expect(result).toEqual({ added: 0, removed: 0, refused: 0, bypassed: 0 });
  });

  it('still reconciles the pieces that did answer', () => {
    const db = seeded();
    syncPieces(db, hr, [[sample(0, 'awake')], [sample(9, 'awake')]]);

    const result = syncPieces(db, hr, [[sample(0, 'workout')], []]);

    const rows = (db.query('SELECT source FROM heartrate ORDER BY timestamp').all() as Array<{ source: string }>).map(r => r.source);
    db.close();
    expect(rows).toEqual(['workout', 'awake']);
    expect(result).toEqual({ added: 1, removed: 1, refused: 0, bypassed: 0 });
  });

  it('never deletes a row that some piece returned, even if another piece brackets it', () => {
    // The pieces the range is split into are disjoint today, so this cannot happen — but the
    // invariant should hold because of how the plan is built, not because of a property that
    // lives in another module and could change.
    const db = seeded();
    syncPieces(db, hr, [[sample(0, 'awake'), sample(5, 'awake'), sample(9, 'awake')]]);

    // A pathological split: the first piece's scope brackets a sample only the second returned.
    const result = syncPieces(db, hr, [[sample(0, 'awake'), sample(9, 'awake')], [sample(5, 'awake')]]);

    const kept = (db.query('SELECT timestamp FROM heartrate ORDER BY timestamp').all() as Array<{ timestamp: string }>).length;
    db.close();
    expect(kept).toBe(3);
    expect(result).toEqual({ added: 0, removed: 0, refused: 0, bypassed: 0 });
  });

  it('judges the truncation guard per piece, not across the whole range', () => {
    // Ten stored samples in one piece and two in another: dropping eight of the first piece is a
    // majority of that piece, even though it is a minority of everything fetched.
    const db = seeded();
    const wide = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(m => sample(m, 'awake'));
    const other = [sample(30, 'awake'), sample(31, 'awake')];
    syncPieces(db, hr, [wide, other]);

    const result = syncPieces(db, hr, [[sample(0, 'awake'), sample(9, 'awake')], other]);

    const count = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result.refused).toBe(8);
    expect(count).toBe(12);
  });
});

describe('a response that looks truncated', () => {
  it('refuses to delete most of the window and says so', () => {
    // The guard that keeps a rate-limited or partial page from emptying a day's samples.
    const db = seeded();
    syncWindow(db, hr, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(m => sample(m, 'awake')));

    const result = syncWindow(db, hr, [sample(0, 'awake'), sample(9, 'awake')]);

    const count = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result.removed).toBe(0);
    expect(result.refused).toBe(8);
    expect(count).toBe(10);
  });

  it('applies the refused removals when the caller passes prune (#100)', () => {
    // The probe from #100: a sparsely-worn day where Oura legitimately drops 12 of 20 samples.
    // Without the flag this is refused on every run, and no narrower window escapes it — the scope
    // is the returned rows' own bounds, so the ratio never moves.
    const db = seeded();
    const twenty = Array.from({ length: 20 }, (_, m) => sample(m, 'awake'));
    syncWindow(db, hr, twenty);
    const kept = [0, 3, 6, 9, 12, 15, 18, 19].map(m => sample(m, 'awake'));

    expect(syncWindow(db, hr, kept)).toEqual({ added: 0, removed: 0, refused: 12, bypassed: 0 });

    const result = syncWindow(db, hr, kept, { prune: true });

    const rows = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result).toEqual({ added: 0, removed: 12, refused: 0, bypassed: 12 });
    expect(rows).toBe(8);
  });

  it('still deletes nothing on an empty response, prune or not', () => {
    // The flag lifts the truncation guard, not the rule that a piece describing nothing vouches for
    // nothing. Otherwise one 200-with-[] during an outage would empty the table on a --prune run,
    // which is the worst case the guard exists for.
    const db = seeded();
    syncWindow(db, hr, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(m => sample(m, 'awake')));

    const result = syncWindow(db, hr, [], { prune: true });

    const rows = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result).toEqual({ added: 0, removed: 0, refused: 0, bypassed: 0 });
    expect(rows).toBe(10);
  });

  it('leaves rows outside the returned scope alone under prune', () => {
    // A pruning run is still scoped by what the API answered: a day the response never covered
    // keeps its samples.
    const db = seeded();
    syncWindow(db, hr, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(m => sample(m, 'awake')));
    const elsewhere = { timestamp: '2026-08-01T10:00:00+00:00', bpm: 61, source: 'awake' };
    syncWindow(db, hr, [elsewhere]);

    syncWindow(db, hr, [sample(0, 'awake'), sample(9, 'awake')], { prune: true });

    const days = (db.query("SELECT COUNT(*) AS n FROM heartrate WHERE timestamp LIKE '2026-08-01%'").get() as { n: number }).n;
    db.close();
    expect(days).toBe(1);
  });

  it('keeps a row any covering piece doubted, whichever order the pieces arrive in', () => {
    // Two pieces overlap and disagree: the wide one dropped most of its scope and looks truncated,
    // the narrow one dropped four of ten and does not. Minutes 15-18 are stale in both. A verdict
    // taken while walking the pieces would be settled by whichever came first, so the same two
    // responses would delete or keep depending on order.
    const wide = [sample(0, 'awake'), sample(19, 'awake')];                       // scope 00-19
    const narrow = [10, 11, 12, 13, 14, 19].map(m => sample(m, 'awake'));         // scope 10-19

    const outcomes = [[wide, narrow], [narrow, wide]].map(order => {
      const db = seeded();
      syncWindow(db, hr, Array.from({ length: 20 }, (_, m) => sample(m, 'awake')));
      const result = syncPieces(db, hr, order);
      const rows = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
      db.close();
      return { result, rows };
    });

    expect(outcomes[0]).toEqual(outcomes[1]!);
    expect(outcomes[0]!.result).toEqual({ added: 0, removed: 0, refused: 13, bypassed: 0 });
    expect(outcomes[0]!.rows).toBe(20);
  });

  it('counts a row once when two pieces both drop it (#103 review)', () => {
    // Pieces are disjoint by construction, but the API decides what it returns. Counting per piece
    // let one row be staged twice, printing "12 stale removed (24 past the truncation guard)" —
    // a parenthetical larger than the number it qualifies.
    const db = seeded();
    const twenty = Array.from({ length: 20 }, (_, m) => sample(m, 'awake'));
    syncWindow(db, hr, twenty);
    // one row the cache does not hold yet, so arriving twice must still count as one new row
    const kept = [0, 3, 6, 9, 12, 15, 18, 19, 25].map(m => sample(m, 'awake'));

    // the same answer delivered as two pieces whose returned bounds overlap
    const result = syncPieces(db, hr, [kept, kept], { prune: true });

    const rows = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result).toEqual({ added: 1, removed: 12, refused: 0, bypassed: 12 });
    expect(rows).toBe(9);
  });

  it('deletes nothing at all when the API returns an empty window', () => {
    const db = seeded();
    syncWindow(db, hr, [sample(0, 'awake')]);

    const result = syncWindow(db, hr, []);

    const count = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result).toEqual({ added: 0, removed: 0, refused: 0, bypassed: 0 });
    expect(count).toBe(1);
  });
});
