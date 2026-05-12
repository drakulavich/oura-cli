import type { Database } from '../lib/db.js';
import { OuraClient } from '../api/client.js';
import type {
  OuraSleepDay, OuraReadinessDay, OuraActivityDay, OuraHeartRate,
  OuraSpO2Day, OuraStressDay, OuraWorkout, OuraCardiovascularAge,
  OuraSleepModel,
} from '../api/types.js';

export interface ImportResult {
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
}

export async function importDaily(db: Database, client: OuraClient, log?: (msg: string) => void): Promise<ImportResult> {
  const _log = log ?? (() => {});
  const today = new Date().toISOString().slice(0, 10);

  const lastDates: string[] = [];
  for (const tbl of ['daily_sleep', 'daily_readiness', 'daily_activity'] as const) {
    const row = db.query(`SELECT MAX(day) as d FROM ${tbl}`).get() as { d: string | null };
    if (row?.d) lastDates.push(row.d);
  }
  const startDate = lastDates.length > 0
    ? lastDates.sort()[0]
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  _log(`Syncing from ${startDate} to ${today}`);

  const counts: Record<string, number> = {};

  const sleepData = await client.fetch<OuraSleepDay>('daily_sleep', startDate, today);
  const insertSleep = db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)');
  for (const s of sleepData) {
    insertSleep.run(s.id, s.day, s.score, JSON.stringify(s.contributors), s.timestamp);
    _log(`  + sleep ${s.day}`);
  }
  counts.daily_sleep = sleepData.length;

  const readinessData = await client.fetch<OuraReadinessDay>('daily_readiness', startDate, today);
  const insertReadiness = db.query('INSERT OR REPLACE INTO daily_readiness VALUES (?,?,?,?,?,?,?)');
  for (const r of readinessData) {
    insertReadiness.run(r.id, r.day, r.score, JSON.stringify(r.contributors),
      r.temperature_deviation, r.temperature_trend_deviation, r.timestamp);
    _log(`  + readiness ${r.day}`);
  }
  counts.daily_readiness = readinessData.length;

  const activityData = await client.fetch<OuraActivityDay>('daily_activity', startDate, today);
  const insertActivity = db.query('INSERT OR REPLACE INTO daily_activity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const a of activityData) {
    insertActivity.run(a.id, a.day, a.score, a.active_calories, a.steps,
      a.equivalent_walking_distance, a.high_activity_time, a.medium_activity_time,
      a.low_activity_time, a.sedentary_time, a.total_calories, a.target_calories,
      JSON.stringify(a.contributors), a.timestamp);
    _log(`  + activity ${a.day}`);
  }
  counts.daily_activity = activityData.length;

  const hrData = await client.fetch<OuraHeartRate>('heartrate', today, today);
  const insertHr = db.query('INSERT OR IGNORE INTO heartrate VALUES (?,?,?,?)');
  for (const h of hrData) {
    const day = h.timestamp.slice(0, 10);
    insertHr.run(h.timestamp, h.bpm, h.source, day);
  }
  counts.heartrate = hrData.length;
  if (hrData.length > 0) _log(`  + heartrate ${hrData.length} records`);

  const spo2Data = await client.fetch<OuraSpO2Day>('daily_spo2', startDate, today);
  const insertSpo2 = db.query('INSERT OR REPLACE INTO daily_spo2 VALUES (?,?,?,?)');
  for (const s of spo2Data) {
    const avg = s.spo2_percentage?.average ?? null;
    insertSpo2.run(s.id, s.day, avg, s.breathing_disturbance_index);
    _log(`  + spo2 ${s.day}`);
  }
  counts.daily_spo2 = spo2Data.length;

  const stressData = await client.fetch<OuraStressDay>('daily_stress', startDate, today);
  const insertStress = db.query('INSERT OR REPLACE INTO daily_stress VALUES (?,?,?,?,?)');
  for (const s of stressData) {
    insertStress.run(s.id, s.day, s.day_summary, s.recovery_high, s.stress_high);
    _log(`  + stress ${s.day}`);
  }
  counts.daily_stress = stressData.length;

  const workoutData = await client.fetch<OuraWorkout>('workout', startDate, today);
  const insertWorkout = db.query('INSERT OR REPLACE INTO workouts VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const w of workoutData) {
    insertWorkout.run(w.id, w.day, w.activity, w.calories, w.distance,
      w.start_datetime, w.end_datetime, w.intensity, w.label ?? '', w.source);
    _log(`  + workout ${w.day} ${w.activity}`);
  }
  counts.workouts = workoutData.length;

  const sleepPeriods = await client.fetch<OuraSleepModel>('sleep', startDate, today);
  const insertSleepModel = db.query(`INSERT OR REPLACE INTO sleep_model VALUES (${Array(19).fill('?').join(',')})`);
  for (const sp of sleepPeriods) {
    insertSleepModel.run(
      sp.id, sp.day, sp.average_breath, sp.average_heart_rate, sp.average_hrv,
      sp.awake_time, sp.bedtime_end, sp.bedtime_start, sp.deep_sleep_duration,
      sp.efficiency, sp.latency, sp.light_sleep_duration, sp.lowest_heart_rate,
      sp.period, sp.rem_sleep_duration, sp.restless_periods, sp.time_in_bed,
      sp.total_sleep_duration, sp.type,
    );
    _log(`  + sleep_period ${sp.day} (${sp.type})`);
  }
  counts.sleep_model = sleepPeriods.length;

  const cvData = await client.fetch<OuraCardiovascularAge>('daily_cardiovascular_age', startDate, today);
  const insertCv = db.query('INSERT OR REPLACE INTO cardiovascular_age VALUES (?,?,?)');
  for (const c of cvData) {
    insertCv.run(c.id, c.day, c.vascular_age);
    _log(`  + cardiovascular_age ${c.day}`);
  }
  counts.cardiovascular_age = cvData.length;

  _log('Import complete.');
  return { startDate, endDate: today, counts };
}
