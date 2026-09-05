import type { Database } from '../lib/db.js';
import { shiftDay } from '../lib/time.js';

export interface DaySummary {
  day: string;
  sleep_score: number | null;
  readiness_score: number | null;
  activity_score: number | null;
  steps: number | null;
  stress: string | null;
  spo2: number | null;
  temp_deviation: number | null;
  sleep_hours: number | null;
  deep_hours: number | null;
  rem_hours: number | null;
  avg_hrv: number | null;
  lowest_hr: number | null;
  efficiency: number | null;
}

export function getDaySummary(db: Database, day: string): DaySummary {
  const sl = db.query('SELECT score FROM daily_sleep WHERE day=?').get(day) as { score: number | null } | undefined;
  const rd = db.query('SELECT score, temperature_deviation FROM daily_readiness WHERE day=?').get(day) as { score: number | null; temperature_deviation: number | null } | undefined;
  const ac = db.query('SELECT score, steps FROM daily_activity WHERE day=?').get(day) as { score: number | null; steps: number | null } | undefined;
  const st = db.query('SELECT day_summary FROM daily_stress WHERE day=?').get(day) as { day_summary: string | null } | undefined;
  const sp = db.query('SELECT spo2_average FROM daily_spo2 WHERE day=?').get(day) as { spo2_average: number | null } | undefined;
  const sm = db.query(`SELECT total_sleep_duration, deep_sleep_duration, rem_sleep_duration, average_hrv, lowest_heart_rate, efficiency FROM sleep_model WHERE day=? AND type='long_sleep'`).get(day) as {
    total_sleep_duration: number | null; deep_sleep_duration: number | null; rem_sleep_duration: number | null;
    average_hrv: number | null; lowest_heart_rate: number | null; efficiency: number | null;
  } | undefined;

  return {
    day,
    sleep_score: sl?.score ?? null,
    readiness_score: rd?.score ?? null,
    activity_score: ac?.score ?? null,
    steps: ac?.steps ?? null,
    stress: st?.day_summary ?? null,
    spo2: sp?.spo2_average ?? null,
    temp_deviation: rd?.temperature_deviation ?? null,
    sleep_hours: sm?.total_sleep_duration ? +(sm.total_sleep_duration / 3600).toFixed(1) : null,
    deep_hours: sm?.deep_sleep_duration ? +(sm.deep_sleep_duration / 3600).toFixed(1) : null,
    rem_hours: sm?.rem_sleep_duration ? +(sm.rem_sleep_duration / 3600).toFixed(1) : null,
    avg_hrv: sm?.average_hrv ?? null,
    lowest_hr: sm?.lowest_heart_rate ?? null,
    efficiency: sm?.efficiency ?? null,
  };
}

export interface TrendRow {
  label: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export function getTrends(db: Database, days: number, today: string): TrendRow[] {
  const start = shiftDay(today, -days);
  const results: TrendRow[] = [];

  const metrics: [string, string, string][] = [
    ['Sleep Score', 'daily_sleep', 'score'],
    ['Readiness', 'daily_readiness', 'score'],
    ['Activity', 'daily_activity', 'score'],
    ['Steps', 'daily_activity', 'steps'],
    ['Active Cal', 'daily_activity', 'active_calories'],
  ];

  for (const [label, table, col] of metrics) {
    const row = db.query(
      `SELECT AVG(${col}) as avg, MIN(${col}) as min, MAX(${col}) as max, COUNT(${col}) as count FROM ${table} WHERE day BETWEEN ? AND ?`
    ).get(start, today) as { avg: number | null; min: number | null; max: number | null; count: number };
    if (row.count > 0 && row.avg !== null) {
      results.push({ label, avg: +row.avg.toFixed(0), min: row.min!, max: row.max!, count: row.count });
    }
  }

  const sp = db.query(
    'SELECT AVG(spo2_average) as avg, MIN(spo2_average) as min, MAX(spo2_average) as max, COUNT(*) as count FROM daily_spo2 WHERE day BETWEEN ? AND ?'
  ).get(start, today) as { avg: number | null; min: number | null; max: number | null; count: number };
  if (sp.count > 0 && sp.avg !== null) {
    results.push({ label: 'SpO2', avg: +sp.avg.toFixed(1), min: +sp.min!.toFixed(1), max: +sp.max!.toFixed(1), count: sp.count });
  }

  return results;
}

export interface TableStats {
  table: string;
  rows: number;
}

export interface DbStats {
  tables: TableStats[];
  dateRange: { first: string | null; last: string | null };
  trends: TrendRow[];
  records: { mostSteps: { day: string; steps: number } | null; bestSleep: { day: string; score: number } | null };
}

export function getStats(db: Database, today: string): DbStats {
  const tableNames = [
    'daily_sleep', 'daily_readiness', 'daily_activity', 'daily_spo2',
    'daily_stress', 'heartrate', 'vo2max', 'cardiovascular_age', 'workouts', 'sleep_model',
  ];
  const tables = tableNames.map(table => {
    const row = db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    return { table, rows: row.cnt };
  });

  const range = db.query('SELECT MIN(day) as first, MAX(day) as last FROM daily_sleep').get() as { first: string | null; last: string | null };
  const trends = getTrends(db, 99999, today);

  const mostSteps = db.query('SELECT day, steps FROM daily_activity WHERE steps IS NOT NULL ORDER BY steps DESC LIMIT 1').get() as { day: string; steps: number } | undefined;
  const bestSleep = db.query('SELECT day, score FROM daily_sleep WHERE score IS NOT NULL ORDER BY score DESC LIMIT 1').get() as { day: string; score: number } | undefined;

  return {
    tables,
    dateRange: range,
    trends,
    records: {
      mostSteps: mostSteps ?? null,
      bestSleep: bestSleep ?? null,
    },
  };
}
