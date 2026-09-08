import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { planWindow, applyWindowPlan, identityColumns } from './reconcile.js';
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
function syncWindow(db: Database, c: AnyCollection, rows: unknown[]): { added: number; removed: number; refused?: number } {
  const stmt = db.query(insertSql(c));
  const plan = planWindow(db, c, rows);
  for (const row of rows) stmt.run(...rowValues(c, row));
  return { added: plan.added, removed: applyWindowPlan(db, c, plan), ...(plan.refused === undefined ? {} : { refused: plan.refused }) };
}

const sample = (minute: number, source: string) => ({
  timestamp: `2026-09-01T10:${String(minute).padStart(2, '0')}:00+00:00`, bpm: 60 + minute, source,
});

describe('identityColumns', () => {
  it('takes the primary key when there is one', () => {
    expect(identityColumns(workout)).toEqual(['id']);
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
    expect(result).toEqual({ added: 1, removed: 1 });
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
    expect(result).toEqual({ added: 0, removed: 0 });
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
    expect(result).toEqual({ added: 1, removed: 1 });
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

  it('deletes nothing at all when the API returns an empty window', () => {
    const db = seeded();
    syncWindow(db, hr, [sample(0, 'awake')]);

    const result = syncWindow(db, hr, []);

    const count = (db.query('SELECT COUNT(*) AS n FROM heartrate').get() as { n: number }).n;
    db.close();
    expect(result).toEqual({ added: 0, removed: 0 });
    expect(count).toBe(1);
  });
});
