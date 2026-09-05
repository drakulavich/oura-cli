import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './database.js';
import { getReport } from './report.js';
import { shiftDay } from '../lib/time.js';

// Characterization tests for src/db/report.ts (getReport).
//
// getReport computes its window relative to the `today` argument it is given,
// so the tests seed rows at day offsets measured from a fixed anchor date and
// assert against the window getReport derives internally. `day(n)` returns
// the ISO date n days before TODAY — day(0) is TODAY (== weekEnd), day(6) is
// the start of a 7-day window (== weekStart). Each test gets a fresh
// in-memory db so windows and aggregates are fully deterministic and isolated.

const TODAY = '2026-06-15';

let db: Database;
let idSeq = 0;
const nextId = () => `r${idSeq++}`;

const day = (n: number): string => shiftDay(TODAY, -n);

function insertSleep(dayStr: string, score: number | null): void {
  db.query('INSERT INTO daily_sleep (id, day, score) VALUES (?,?,?)').run(nextId(), dayStr, score);
}
function insertReadiness(dayStr: string, score: number | null): void {
  db.query('INSERT INTO daily_readiness (id, day, score) VALUES (?,?,?)').run(nextId(), dayStr, score);
}
function insertActivity(dayStr: string, score: number | null, steps: number | null): void {
  db.query('INSERT INTO daily_activity (id, day, score, steps) VALUES (?,?,?,?)').run(
    nextId(), dayStr, score, steps
  );
}
function insertSpo2(dayStr: string, avg: number | null): void {
  db.query('INSERT INTO daily_spo2 (id, day, spo2_average) VALUES (?,?,?)').run(nextId(), dayStr, avg);
}
function insertSleepModel(
  dayStr: string,
  type: string,
  fields: {
    total?: number; deep?: number; rem?: number; light?: number;
    efficiency?: number; hrv?: number; lowestHr?: number;
  }
): void {
  db.query(
    `INSERT INTO sleep_model
       (id, day, type, total_sleep_duration, deep_sleep_duration, rem_sleep_duration,
        light_sleep_duration, efficiency, average_hrv, lowest_heart_rate)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    nextId(), dayStr, type,
    fields.total ?? null, fields.deep ?? null, fields.rem ?? null,
    fields.light ?? null, fields.efficiency ?? null, fields.hrv ?? null, fields.lowestHr ?? null
  );
}

beforeEach(() => {
  db = new Database(':memory:');
  ensureSchema(db);
});

describe('getReport today anchoring', () => {
  it('anchors the window on the today it is given, not on the UTC clock', () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('a', '2026-06-15', 80, '{}', 't');
    const r = getReport(db, 7, '2026-06-15');
    expect(r.weekEnd).toBe('2026-06-15');
    expect(r.weekStart).toBe('2026-06-09');
    expect(r.days.at(-1)?.sleep).toBe(80);
  });
});

describe('getReport period classification', () => {
  it('labels a window of 7 days or fewer as "week" and a longer window as "month"', () => {
    // The boundary sits at `days <= 7`: 7 is still a week, 8 tips over to month.
    expect(getReport(db, 7, TODAY).period).toBe('week');
    expect(getReport(db, 8, TODAY).period).toBe('month');
  });
});

describe('getReport daily rows', () => {
  it('returns one row per requested day, oldest first, spanning weekStart..weekEnd', () => {
    const report = getReport(db, 7, TODAY);

    expect(report.days).toHaveLength(7);
    expect(report.days[0]!.day).toBe(day(6));
    expect(report.days[6]!.day).toBe(day(0));
    expect(report.weekStart).toBe(day(6));
    expect(report.weekEnd).toBe(day(0));
    // dayLabel formats as "<Wkd> DD/MM".
    expect(report.days[6]!.dayLabel).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}\/\d{2}$/);
  });

  it('fills scores from matching rows and leaves null where a day has no data', () => {
    insertSleep(day(1), 82);
    insertActivity(day(1), 90, 8000);
    // day(2) intentionally has no rows.

    const report = getReport(db, 7, TODAY);
    const withData = report.days.find(d => d.day === day(1))!;
    const withoutData = report.days.find(d => d.day === day(2))!;

    expect(withData.sleep).toBe(82);
    expect(withData.activity).toBe(90);
    expect(withData.steps).toBe(8000);
    expect(withData.readiness).toBeNull();
    expect(withoutData.sleep).toBeNull();
    expect(withoutData.activity).toBeNull();
    expect(withoutData.steps).toBeNull();
  });
});

describe('getReport averages', () => {
  it('reports avg/min/max per populated metric and flags only the Steps metric with isSteps', () => {
    insertSleep(day(1), 80);
    insertSleep(day(2), 90);
    insertActivity(day(1), 88, 9000);

    const averages = getReport(db, 7, TODAY).averages;
    const sleep = averages.find(a => a.label === 'Sleep')!;
    const steps = averages.find(a => a.label === 'Steps')!;

    expect(sleep.avg).toBe(85);
    expect(sleep.min).toBe(80);
    expect(sleep.max).toBe(90);
    expect(sleep.isSteps).toBe(false);
    expect(steps.avg).toBe(9000);
    expect(steps.isSteps).toBe(true);
  });

  it('computes diff against the previous window when the previous window has data', () => {
    // 7-day window: current is day(6)..day(0), previous is day(13)..day(7).
    insertSleep(day(1), 80); // current
    insertSleep(day(8), 70); // previous window

    const sleep = getReport(db, 7, TODAY).averages.find(a => a.label === 'Sleep')!;

    expect(sleep.avg).toBe(80);
    expect(sleep.prevAvg).toBe(70);
    expect(sleep.diff).toBe(10);
  });

  it('leaves prevAvg and diff null when the previous window has no data', () => {
    insertSleep(day(1), 80); // current only

    const sleep = getReport(db, 7, TODAY).averages.find(a => a.label === 'Sleep')!;

    expect(sleep.prevAvg).toBeNull();
    expect(sleep.diff).toBeNull();
  });

  it('omits metrics entirely when the current window has no rows for them', () => {
    expect(getReport(db, 7, TODAY).averages).toEqual([]);
  });
});

describe('getReport spo2', () => {
  it('returns avg/min/max rounded to one decimal place', () => {
    insertSpo2(day(1), 95.44);
    insertSpo2(day(2), 96.86);

    const spo2 = getReport(db, 7, TODAY).spo2!;

    expect(spo2.avg).toBe(96.2); // (95.44 + 96.86) / 2 = 96.15 -> toFixed(1) = 96.2
    expect(spo2.min).toBe(95.4);
    expect(spo2.max).toBe(96.9);
  });

  it('returns null when no spo2 rows fall in the window', () => {
    expect(getReport(db, 7, TODAY).spo2).toBeNull();
  });
});

describe('getReport patterns', () => {
  it('surfaces low sleep and readiness (score < 70, ascending) and high activity (score >= 90, descending)', () => {
    // Low sleep: only scores strictly below 70 qualify, ordered ascending.
    insertSleep(day(1), 65);
    insertSleep(day(2), 50);
    insertSleep(day(3), 80); // excluded (>= 70)
    // Low readiness: same threshold and ordering.
    insertReadiness(day(1), 68);
    insertReadiness(day(2), 55);
    // High activity: only scores >= 90 qualify, ordered descending, carrying steps.
    insertActivity(day(1), 95, 12000);
    insertActivity(day(2), 90, 9000);
    insertActivity(day(3), 85, 4000); // excluded (< 90)

    const { lowSleep, lowReadiness, highActivity } = getReport(db, 7, TODAY).patterns;

    expect(lowSleep.map(r => r.score)).toEqual([50, 65]);
    expect(lowReadiness.map(r => r.score)).toEqual([55, 68]);
    expect(highActivity.map(r => r.score)).toEqual([95, 90]);
    expect(highActivity[0]!.steps).toBe(12000);
    expect(highActivity[0]!.dayLabel).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}\/\d{2}$/);
  });

  it('returns empty pattern lists when nothing crosses the thresholds', () => {
    insertSleep(day(1), 90);
    insertReadiness(day(1), 90);
    insertActivity(day(1), 50, 3000);

    const { lowSleep, lowReadiness, highActivity } = getReport(db, 7, TODAY).patterns;

    expect(lowSleep).toEqual([]);
    expect(lowReadiness).toEqual([]);
    expect(highActivity).toEqual([]);
  });
});

describe('getReport sleep details', () => {
  it('averages sleep_model rows of type long_sleep within the window', () => {
    insertSleepModel(day(1), 'long_sleep', {
      total: 28800, deep: 6000, rem: 5400, light: 17400, efficiency: 90, hrv: 40, lowestHr: 50,
    });
    insertSleepModel(day(2), 'long_sleep', {
      total: 25200, deep: 5000, rem: 4600, light: 15600, efficiency: 88, hrv: 44, lowestHr: 52,
    });

    const sd = getReport(db, 7, TODAY).sleepDetails!;

    expect(sd.totalSleep).toBe(27000); // (28800 + 25200) / 2
    expect(sd.efficiency).toBe(89);
    expect(sd.hrv).toBe(42);
    expect(sd.lowestHr).toBe(51);
  });

  it('returns null when the window has no long_sleep rows (other sleep types are ignored)', () => {
    insertSleepModel(day(1), 'late_nap', { total: 3600, deep: 600, rem: 500 });

    expect(getReport(db, 7, TODAY).sleepDetails).toBeNull();
  });
});

describe('getReport recommendations', () => {
  it('flags low sleep, readiness, and steps when averages fall below their thresholds', () => {
    insertSleep(day(1), 70);      // < 75
    insertReadiness(day(1), 65);  // < 70
    insertActivity(day(1), 80, 5000); // steps < 8000

    expect(getReport(db, 7, TODAY).recommendations).toEqual(
      expect.arrayContaining(['sleep_low', 'readiness_low', 'steps_low'])
    );
  });

  it('flags great sleep, readiness, and steps when averages meet their high thresholds', () => {
    insertSleep(day(1), 90);       // >= 85
    insertReadiness(day(1), 85);   // >= 80
    insertActivity(day(1), 95, 12000); // steps >= 10000

    expect(getReport(db, 7, TODAY).recommendations).toEqual(
      expect.arrayContaining(['sleep_great', 'readiness_great', 'steps_great'])
    );
  });

  it('emits no recommendations for mid-range averages inside the threshold gaps', () => {
    insertSleep(day(1), 75);       // not < 75, not >= 85
    insertReadiness(day(1), 75);   // not < 70, not >= 80
    insertActivity(day(1), 80, 9000); // not < 8000, not >= 10000

    expect(getReport(db, 7, TODAY).recommendations).toEqual([]);
  });
});
