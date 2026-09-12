import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { getReport } from './report.js';
import { getDaySummary, getTrends } from './queries.js';
import { SLOTS_PER_DAY } from './day-complete.js';
import { daysBack } from '../lib/time.js';

// #75: the same seven days used to give three different answers — `report` cut the day in progress
// from its averages, `db trends` averaged it as a whole day, and `db week` showed it unmarked. All
// three now read the same source, so the only thing this file asserts is that they agree.

const TODAY = '2026-06-15';

function seeded(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  const week = daysBack(TODAY, 7);
  for (const [i, day] of week.entries()) {
    const last = day === TODAY;
    db.query('INSERT INTO daily_activity (id, day, score, steps, active_calories, class_5_min_slots) VALUES (?,?,?,?,?,?)')
      .run(`a${i}`, day, 70, last ? 809 : 9000, 300, last ? 150 : SLOTS_PER_DAY);
    db.query('INSERT INTO daily_sleep (id, day, score, contributors, timestamp) VALUES (?,?,?,?,?)')
      .run(`s${i}`, day, 80, '{}', '');
  }
  return db;
}

describe('report, trends and the week table on one cache', () => {
  it('agree on which day is still accumulating, and none of them averages it', () => {
    const db = seeded();

    const report = getReport(db, 7, TODAY);
    const trends = getTrends(db, 7, TODAY);
    const week = daysBack(TODAY, 7).map(d => getDaySummary(db, d, TODAY));
    db.close();

    // `report`: today marked, averages stop at yesterday.
    expect(report.days.filter(d => d.partial).map(d => d.day)).toEqual([TODAY]);
    expect(report.completeThrough).toBe('2026-06-14');
    const reportSteps = report.averages.find(a => a.label === 'Steps')!;

    // `db trends`: the same six days, so the same average — and today's 809 is not the minimum.
    const trendSteps = trends.find(t => t.label === 'Steps')!;
    expect(trendSteps.count).toBe(6);
    expect(trendSteps.avg).toBe(9000);
    expect(trendSteps.min).toBe(9000);
    expect(trendSteps.avg).toBe(reportSteps.avg);
    expect(trendSteps.count).toBe(reportSteps.count);

    // Sleep is final once it exists, so it still covers all seven.
    expect(trends.find(t => t.label === 'Sleep Score')!.count).toBe(7);

    // `db week`: today carries the flag the other two act on.
    expect(week.filter(d => d.partial).map(d => d.day)).toEqual([TODAY]);
    expect(week.find(d => d.day === TODAY)!.steps).toBe(809); // still shown, just marked
  });

  it('lets a quiet ring close its last day everywhere at once', () => {
    // Nothing after 06-10, but that day's slots prove it is over: it belongs in every average.
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query('INSERT INTO daily_activity (id, day, score, steps, class_5_min_slots) VALUES (?,?,?,?,?)')
      .run('a', '2026-06-10', 70, 12000, SLOTS_PER_DAY);

    const report = getReport(db, 7, TODAY);
    const trends = getTrends(db, 7, TODAY);
    const week = daysBack(TODAY, 7).map(d => getDaySummary(db, d, TODAY));
    db.close();

    expect(report.days.filter(d => d.partial)).toEqual([]);
    expect(report.completeThrough).toBe('2026-06-10');
    expect(trends.find(t => t.label === 'Steps')!.avg).toBe(12000);
    expect(week.filter(d => d.partial)).toEqual([]);
  });
});

describe('trends with nothing complete in the window', () => {
  it('drops the activity rows entirely rather than averaging the day in progress', () => {
    // Only today has a record and today is not over. `report` already pins this case; `db trends`
    // has its own fallback for it (queries.ts, `?? shiftDay(start, -1)`), and without this test that
    // line could be replaced by `?? today` and the suite would still pass: #75 reopened silently.
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query('INSERT INTO daily_activity (id, day, score, steps, active_calories, class_5_min_slots) VALUES (?,?,?,?,?,?)')
      .run('a', TODAY, 70, 809, 300, 150);
    db.query('INSERT INTO daily_sleep (id, day, score, contributors, timestamp) VALUES (?,?,?,?,?)')
      .run('s', TODAY, 80, '{}', '');

    const trends = getTrends(db, 7, TODAY);
    const report = getReport(db, 7, TODAY);
    db.close();

    expect(trends.find(t => t.label === 'Steps')).toBeUndefined();
    expect(trends.find(t => t.label === 'Activity')).toBeUndefined();
    expect(trends.find(t => t.label === 'Sleep Score')!.count).toBe(1); // sleep is final once it exists
    expect(report.averages.find(a => a.label === 'Steps')).toBeUndefined();
  });
});
