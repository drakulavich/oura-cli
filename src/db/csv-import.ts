import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Database } from './open.js';

const CSV_DIR = join(process.env.HOME ?? '', 'Documents/OpenClaw/projects/oura-ring/data/App Data');

function parseCSV(filename: string): Record<string, string>[] {
  const path = join(CSV_DIR, filename);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(';');
  return lines.slice(1).map(line => {
    const vals = line.split(';');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

function num(v: string | undefined): number | null {
  if (!v || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function str(v: string | undefined): string | null {
  return v && v !== '' ? v : null;
}

export function importFromCSV(db: Database, log: (msg: string) => void): void {
  if (!existsSync(CSV_DIR)) {
    throw new Error(`CSV directory not found: ${CSV_DIR}`);
  }

  // daily_sleep
  const sleep = parseCSV('dailysleep.csv');
  const insertSleep = db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)');
  const sleepTx = db.transaction(() => {
    for (const r of sleep) insertSleep.run(r.id, r.day, num(r.score), str(r.contributors), str(r.timestamp));
  });
  sleepTx();
  log(`daily_sleep: ${sleep.length} rows`);

  // daily_readiness
  const readiness = parseCSV('dailyreadiness.csv');
  const insertReadiness = db.query('INSERT OR REPLACE INTO daily_readiness VALUES (?,?,?,?,?,?,?)');
  const readinessTx = db.transaction(() => {
    for (const r of readiness) insertReadiness.run(r.id, r.day, num(r.score), str(r.contributors),
      num(r.temperature_deviation), num(r.temperature_trend_deviation), str(r.timestamp));
  });
  readinessTx();
  log(`daily_readiness: ${readiness.length} rows`);

  // daily_activity
  const activity = parseCSV('dailyactivity.csv');
  const insertActivity = db.query('INSERT OR REPLACE INTO daily_activity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const activityTx = db.transaction(() => {
    for (const r of activity) insertActivity.run(r.id, r.day, num(r.score), num(r.active_calories),
      num(r.steps), num(r.equivalent_walking_distance), num(r.high_activity_time),
      num(r.medium_activity_time), num(r.low_activity_time), num(r.sedentary_time),
      num(r.total_calories), num(r.target_calories), str(r.contributors), str(r.timestamp));
  });
  activityTx();
  log(`daily_activity: ${activity.length} rows`);

  // daily_spo2 — spo2_percentage is JSON like {"average": 99.046}
  const spo2 = parseCSV('dailyspo2.csv');
  const insertSpo2 = db.query('INSERT OR REPLACE INTO daily_spo2 VALUES (?,?,?,?)');
  const spo2Tx = db.transaction(() => {
    for (const r of spo2) {
      let avg: number | null = null;
      try {
        const parsed = JSON.parse(r.spo2_percentage);
        avg = parsed?.average ?? null;
      } catch { /* ignore */ }
      insertSpo2.run(r.id, r.day, avg, num(r.breathing_disturbance_index));
    }
  });
  spo2Tx();
  log(`daily_spo2: ${spo2.length} rows`);

  // daily_stress
  const stress = parseCSV('dailystress.csv');
  const insertStress = db.query('INSERT OR REPLACE INTO daily_stress VALUES (?,?,?,?,?)');
  const stressTx = db.transaction(() => {
    for (const r of stress) insertStress.run(r.id, r.day, str(r.day_summary), num(r.recovery_high), num(r.stress_high));
  });
  stressTx();
  log(`daily_stress: ${stress.length} rows`);

  // heartrate
  const hr = parseCSV('heartrate.csv');
  const insertHr = db.query('INSERT OR IGNORE INTO heartrate VALUES (?,?,?,?)');
  const hrTx = db.transaction(() => {
    for (const r of hr) {
      const day = r.timestamp?.slice(0, 10) ?? null;
      insertHr.run(r.timestamp, num(r.bpm), str(r.source), day);
    }
  });
  hrTx();
  log(`heartrate: ${hr.length} rows`);

  // sleep_model
  const sleepModel = parseCSV('sleepmodel.csv');
  const insertSM = db.query('INSERT OR REPLACE INTO sleep_model VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const smTx = db.transaction(() => {
    for (const r of sleepModel) insertSM.run(r.id, r.day, num(r.average_breath), num(r.average_heart_rate),
      num(r.average_hrv), num(r.awake_time), str(r.bedtime_end), str(r.bedtime_start),
      num(r.deep_sleep_duration), num(r.efficiency), num(r.latency), num(r.light_sleep_duration),
      num(r.lowest_heart_rate), num(r.period), num(r.rem_sleep_duration), num(r.restless_periods),
      num(r.time_in_bed), num(r.total_sleep_duration), str(r.type));
  });
  smTx();
  log(`sleep_model: ${sleepModel.length} rows`);

  // vo2max
  const vo2 = parseCSV('vo2max.csv');
  const insertVo2 = db.query('INSERT OR REPLACE INTO vo2max VALUES (?,?,?,?)');
  const vo2Tx = db.transaction(() => {
    for (const r of vo2) insertVo2.run(r.id, r.day, num(r.vo2_max), str(r.timestamp));
  });
  vo2Tx();
  log(`vo2max: ${vo2.length} rows`);

  // cardiovascular_age
  const cv = parseCSV('dailycardiovascularage.csv');
  const insertCv = db.query('INSERT OR REPLACE INTO cardiovascular_age VALUES (?,?,?)');
  const cvTx = db.transaction(() => {
    for (const r of cv) insertCv.run(r.id, r.day, num(r.vascular_age));
  });
  cvTx();
  log(`cardiovascular_age: ${cv.length} rows`);

  // workouts
  const workouts = parseCSV('workout.csv');
  const insertW = db.query('INSERT OR REPLACE INTO workouts VALUES (?,?,?,?,?,?,?,?,?,?)');
  const wTx = db.transaction(() => {
    for (const r of workouts) insertW.run(r.id, r.day, str(r.activity), num(r.calories),
      num(r.distance), str(r.start_datetime), str(r.end_datetime), str(r.intensity), str(r.label), str(r.source));
  });
  wTx();
  log(`workouts: ${workouts.length} rows`);

  log('CSV import complete.');
}
