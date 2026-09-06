import type { Database } from './open.js';
import { daysBack, localDateToUtcRange, shiftDay } from '../lib/time.js';

export interface ReportData {
  period: 'week' | 'month';
  weekStart: string;
  weekEnd: string;
  days: {
    day: string;
    dayLabel: string;
    sleep: number | null;
    readiness: number | null;
    activity: number | null;
    steps: number | null;
    /**
     * Activity totals for this day are still accumulating (see `completeThrough`). Normally only the newest
     * day with activity; several when activity rows exist past the ring's last known upload.
     */
    partial: boolean;
  }[];
  /**
   * Last day of the window whose activity totals are final: the day is over in the user's timezone and the
   * ring has uploaded past its end. Activity/steps averages, the high-activity pattern and the steps
   * recommendation stop here; sleep and readiness are never partial and use the whole window.
   * Null when no day in the window is complete yet.
   */
  completeThrough: string | null;
  /** Newest heart-rate sample in the cache (ISO 8601 UTC) — the ring's last upload as far as the cache knows. */
  lastUpload: string | null;
  averages: {
    label: string;
    avg: number;
    min: number;
    max: number;
    /** Days that contributed to `avg`. */
    count: number;
    prevAvg: number | null;
    diff: number | null;
    isSteps: boolean;
  }[];
  spo2: { avg: number; min: number; max: number } | null;
  patterns: {
    lowSleep: { day: string; dayLabel: string; score: number }[];
    lowReadiness: { day: string; dayLabel: string; score: number }[];
    highActivity: { day: string; dayLabel: string; score: number; steps: number | null }[];
  };
  sleepDetails: {
    totalSleep: number | null;
    deepSleep: number | null;
    remSleep: number | null;
    lightSleep: number | null;
    efficiency: number | null;
    hrv: number | null;
    lowestHr: number | null;
  } | null;
  recommendations: string[];
}


function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day} ${dd}/${mm}`;
}

export function getReport(db: Database, days: number, today: string, tz = 'UTC'): ReportData {
  const period: 'week' | 'month' = days <= 7 ? 'week' : 'month';
  const weekEnd = today;
  const weekStart = shiftDay(today, -(days - 1));
  const prevWeekEnd = shiftDay(today, -days);
  const prevWeekStart = shiftDay(today, -(days * 2 - 1));
  const windowDays = daysBack(today, days);

  // Activity accumulates all day, so a day's totals are final only once the day is over locally *and* the
  // ring has uploaded past its end; the newest heart-rate sample is the cache's view of that upload. Without
  // any sample the calendar alone decides. Sleep and readiness scores exist only once the night is over,
  // so they are never partial and are not cut here.
  const lastUpload = (db.query('SELECT MAX(timestamp) AS t FROM heartrate').get() as { t: string | null }).t;
  const isComplete = (d: string): boolean =>
    d < today && (lastUpload === null || Date.parse(localDateToUtcRange(d, tz)[1]) <= Date.parse(lastUpload));
  const completeThrough = [...windowDays].reverse().find(isComplete) ?? null;
  const activityEnd = completeThrough ?? shiftDay(weekStart, -1); // BETWEEN with start > end selects nothing

  // Daily table
  const dailyRows: ReportData['days'] = [];
  for (const d of windowDays) {
    const sl = db.query('SELECT score FROM daily_sleep WHERE day=?').get(d) as { score: number | null } | undefined;
    const rd = db.query('SELECT score FROM daily_readiness WHERE day=?').get(d) as { score: number | null } | undefined;
    const ac = db.query('SELECT score, steps FROM daily_activity WHERE day=?').get(d) as { score: number | null; steps: number | null } | undefined;
    dailyRows.push({
      day: d,
      dayLabel: dayLabel(d),
      sleep: sl?.score ?? null,
      readiness: rd?.score ?? null,
      activity: ac?.score ?? null,
      steps: ac?.steps ?? null,
      partial: ac != null && !isComplete(d), // bun:sqlite returns null, not undefined, for no row
    });
  }

  // Averages with period-over-period comparison
  const metrics: [string, string, string, boolean][] = [
    ['Sleep', 'daily_sleep', 'score', false],
    ['Readiness', 'daily_readiness', 'score', false],
    ['Activity', 'daily_activity', 'score', false],
    ['Steps', 'daily_activity', 'steps', true],
  ];

  const averages: ReportData['averages'] = [];
  for (const [label, table, col, isSteps] of metrics) {
    const end = table === 'daily_activity' ? activityEnd : weekEnd;
    const curr = db.query(
      `SELECT AVG(${col}) as avg, MIN(${col}) as min, MAX(${col}) as max, COUNT(${col}) as cnt FROM ${table} WHERE day BETWEEN ? AND ?`
    ).get(weekStart, end) as { avg: number | null; min: number | null; max: number | null; cnt: number };
    const prev = db.query(
      `SELECT AVG(${col}) as avg FROM ${table} WHERE day BETWEEN ? AND ?`
    ).get(prevWeekStart, prevWeekEnd) as { avg: number | null };

    if (curr.cnt > 0 && curr.avg !== null) {
      const diff = prev.avg !== null ? curr.avg - prev.avg : null;
      averages.push({
        label, avg: curr.avg, min: curr.min!, max: curr.max!, count: curr.cnt,
        prevAvg: prev.avg, diff, isSteps,
      });
    }
  }

  // SpO2
  const sp = db.query(
    'SELECT AVG(spo2_average) as avg, MIN(spo2_average) as min, MAX(spo2_average) as max, COUNT(*) as cnt FROM daily_spo2 WHERE day BETWEEN ? AND ?'
  ).get(weekStart, weekEnd) as { avg: number | null; min: number | null; max: number | null; cnt: number };
  const spo2 = sp.cnt > 0 && sp.avg !== null ? { avg: +sp.avg.toFixed(1), min: +sp.min!.toFixed(1), max: +sp.max!.toFixed(1) } : null;

  // Patterns
  const lowSleep = (db.query(
    'SELECT day, score FROM daily_sleep WHERE day BETWEEN ? AND ? AND score < 70 ORDER BY score'
  ).all(weekStart, weekEnd) as { day: string; score: number }[]).map(r => ({ ...r, dayLabel: dayLabel(r.day) }));

  const lowReadiness = (db.query(
    'SELECT day, score FROM daily_readiness WHERE day BETWEEN ? AND ? AND score < 70 ORDER BY score'
  ).all(weekStart, weekEnd) as { day: string; score: number }[]).map(r => ({ ...r, dayLabel: dayLabel(r.day) }));

  const highActivity = (db.query(
    'SELECT day, score, steps FROM daily_activity WHERE day BETWEEN ? AND ? AND score >= 90 ORDER BY score DESC'
  ).all(weekStart, activityEnd) as { day: string; score: number; steps: number | null }[]).map(r => ({ ...r, dayLabel: dayLabel(r.day) }));

  // Sleep details
  const sd = db.query(
    `SELECT AVG(total_sleep_duration) as totalSleep, AVG(deep_sleep_duration) as deepSleep,
            AVG(rem_sleep_duration) as remSleep, AVG(light_sleep_duration) as lightSleep,
            AVG(efficiency) as efficiency, AVG(average_hrv) as hrv, AVG(lowest_heart_rate) as lowestHr
     FROM sleep_model WHERE day BETWEEN ? AND ? AND type='long_sleep'`
  ).get(weekStart, weekEnd) as {
    totalSleep: number | null; deepSleep: number | null; remSleep: number | null;
    lightSleep: number | null; efficiency: number | null; hrv: number | null; lowestHr: number | null;
  };
  const sleepDetails = sd.totalSleep !== null ? sd : null;

  // Recommendations
  const recommendations: string[] = [];
  const avgSleep = db.query('SELECT AVG(score) as avg FROM daily_sleep WHERE day BETWEEN ? AND ?').get(weekStart, weekEnd) as { avg: number | null };
  const avgReady = db.query('SELECT AVG(score) as avg FROM daily_readiness WHERE day BETWEEN ? AND ?').get(weekStart, weekEnd) as { avg: number | null };
  const avgSteps = db.query('SELECT AVG(steps) as avg FROM daily_activity WHERE day BETWEEN ? AND ?').get(weekStart, activityEnd) as { avg: number | null };

  if (avgSleep.avg !== null && avgSleep.avg < 75) {
    recommendations.push('sleep_low');
  } else if (avgSleep.avg !== null && avgSleep.avg >= 85) {
    recommendations.push('sleep_great');
  }
  if (avgReady.avg !== null && avgReady.avg < 70) {
    recommendations.push('readiness_low');
  } else if (avgReady.avg !== null && avgReady.avg >= 80) {
    recommendations.push('readiness_great');
  }
  if (avgSteps.avg !== null && avgSteps.avg < 8000) {
    recommendations.push('steps_low');
  } else if (avgSteps.avg !== null && avgSteps.avg >= 10000) {
    recommendations.push('steps_great');
  }

  return { period, weekStart, weekEnd, days: dailyRows, completeThrough, lastUpload, averages, spo2, patterns: { lowSleep, lowReadiness, highActivity }, sleepDetails, recommendations };
}

