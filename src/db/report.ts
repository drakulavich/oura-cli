import type { Database } from '../lib/db.js';

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
  }[];
  averages: {
    label: string;
    avg: number;
    min: number;
    max: number;
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

export function getReport(db: Database, days: number): ReportData {
  const period: 'week' | 'month' = days <= 7 ? 'week' : 'month';
  const today = new Date();
  const weekEnd = today.toISOString().slice(0, 10);
  const weekStartDate = new Date(today.getTime() - (days - 1) * 86400000);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const prevWeekEnd = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const prevWeekStart = new Date(today.getTime() - (days * 2 - 1) * 86400000).toISOString().slice(0, 10);

  // Daily table
  const dailyRows: ReportData['days'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
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
    const curr = db.query(
      `SELECT AVG(${col}) as avg, MIN(${col}) as min, MAX(${col}) as max, COUNT(${col}) as cnt FROM ${table} WHERE day BETWEEN ? AND ?`
    ).get(weekStart, weekEnd) as { avg: number | null; min: number | null; max: number | null; cnt: number };
    const prev = db.query(
      `SELECT AVG(${col}) as avg FROM ${table} WHERE day BETWEEN ? AND ?`
    ).get(prevWeekStart, prevWeekEnd) as { avg: number | null };

    if (curr.cnt > 0 && curr.avg !== null) {
      const diff = prev.avg !== null ? curr.avg - prev.avg : null;
      averages.push({
        label, avg: curr.avg, min: curr.min!, max: curr.max!,
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
  ).all(weekStart, weekEnd) as { day: string; score: number; steps: number | null }[]).map(r => ({ ...r, dayLabel: dayLabel(r.day) }));

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
  const avgSteps = db.query('SELECT AVG(steps) as avg FROM daily_activity WHERE day BETWEEN ? AND ?').get(weekStart, weekEnd) as { avg: number | null };

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

  return { period, weekStart, weekEnd, days: dailyRows, averages, spo2, patterns: { lowSleep, lowReadiness, highActivity }, sleepDetails, recommendations };
}

