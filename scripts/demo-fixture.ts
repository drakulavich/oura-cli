// Builds a fake home directory for recording assets/demo.gif: a cache full of synthetic
// data, a placeholder token file, and a `bin/oura-cli` that runs this checkout. Nothing in
// it comes from a real account, so the recording can be published. Usage:
//
//   bun scripts/demo-fixture.ts            # a fresh directory under the system temp dir
//   bun scripts/demo-fixture.ts <dir>      # a directory of your choosing; see below
//   HOME=<dir> PATH=<dir>/bin:$PATH vhs assets/demo.tape
//
// <dir> must not exist yet. The script never deletes anything: a typo such as $HOME must
// not be wiped, and no marker file could make that safe, since a marker can be planted.
//
// The numbers are seeded, so two runs on the same day produce the same cache; the days
// are relative to today in the zone the CLI itself would use (OURA_TZ, else the system
// zone), so the demo always looks current.
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ensureSchema } from '../src/db/open.js';
import { shiftDay, today as todayIn } from '../src/lib/time.js';

// Single-quoted for sh, so a path with spaces or other shell characters still runs, both in the
// shim and in the command printed at the end.
const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

let home: string;
if (process.argv[2] === undefined) {
  home = mkdtempSync(join(tmpdir(), 'oura-demo-'));
} else {
  home = resolve(process.argv[2]);
  if (existsSync(home)) {
    console.error(`refusing to touch ${home}: it already exists. Pick a new directory, or run without an argument.`);
    process.exit(1);
  }
}
mkdirSync(join(home, '.oura-cli'), { recursive: true });
mkdirSync(join(home, 'bin'), { recursive: true });

// A token that authenticates nowhere: the tape runs `doctor --offline`, so it is only found, never sent.
writeFileSync(join(home, '.oura-token'), 'demo-token-not-a-real-credential\n', { mode: 0o600 });
writeFileSync(join(home, 'bin', 'oura-cli'), `#!/bin/sh\nexec bun ${shellQuote(resolve(import.meta.dir, '../src/index.ts'))} "$@"\n`);
chmodSync(join(home, 'bin', 'oura-cli'), 0o755);

// mulberry32: small, seeded, good enough for plausible-looking numbers.
let seed = 0x0a5e11;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
const id = (prefix: string, day: string) => `${prefix}-${day.replace(/-/g, '')}-demo`;
/** `2026-09-14T07:05:00+00:00`: the timestamp shape Oura uses, at a whole minute. */
const at = (day: string, hour: number, minute: number) => `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+00:00`;

const today = todayIn(); // the CLI's own rule: OURA_TZ, else the system zone
const DAYS = 60;

const db = new Database(join(home, '.oura-cli', 'oura.db'));
ensureSchema(db);

/** INSERT one row with the columns named by the object, so each row reads as what it is. */
function insert(table: string, row: Record<string, string | number | null>): void {
  const columns = Object.keys(row);
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(c => `$${c}`).join(', ')})`;
  db.query(sql).run(Object.fromEntries(columns.map(c => [`$${c}`, row[c]])));
}

db.transaction(() => {
  for (let back = DAYS - 1; back >= 0; back--) {
    const day = shiftDay(today, -back);
    const isToday = back === 0;
    const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    // One deliberately poor night a fortnight, so the report has a callout to show.
    const rough = back % 14 === 5;

    insert('daily_sleep', { id: id('sl', day), day, score: rough ? between(58, 66) : between(72, 91), contributors: '{}', timestamp: at(day, 7, 0) });
    insert('daily_readiness', {
      id: id('rd', day), day, score: rough ? between(60, 69) : between(70, 90), contributors: '{}',
      temperature_deviation: +(rand() * 0.6 - 0.3).toFixed(2), temperature_trend_deviation: 0, timestamp: at(day, 7, 0),
    });

    const total = between(23_000, 29_500);
    const deep = between(3_600, 6_000);
    const rem = between(4_000, 7_000);
    insert('sleep_model', {
      id: id('sm', day), day, type: 'long_sleep',
      average_breath: +(13 + rand() * 3).toFixed(2), average_heart_rate: between(52, 60), average_hrv: between(35, 70), awake_time: between(1_200, 3_000),
      bedtime_start: at(shiftDay(day, -1), 23, between(10, 59)), bedtime_end: at(day, 7, between(0, 40)),
      deep_sleep_duration: deep, rem_sleep_duration: rem, light_sleep_duration: total - deep - rem, total_sleep_duration: total,
      time_in_bed: total + between(1_500, 3_500), efficiency: between(82, 94), latency: between(300, 900), lowest_heart_rate: between(44, 52),
      restless_periods: between(2, 9), period: 1,
    });

    // Today is still accumulating: fewer than 288 five-minute slots and a small step count.
    let steps: number;
    if (isToday) steps = between(600, 1_400);
    else if (weekend) steps = between(4_000, 9_000);
    else steps = between(6_500, 13_000);
    insert('daily_activity', {
      id: id('ac', day), day,
      score: isToday ? between(60, 70) : between(64, 93),
      active_calories: isToday ? between(40, 90) : between(250, 620),
      steps,
      total_calories: isToday ? between(400, 700) : between(2_100, 2_900),
      class_5_min_slots: isToday ? between(120, 160) : 288,
      timestamp: at(day, 4, 0),
    });

    // SpO2 is missing on a few nights, as it is on a real ring.
    insert('daily_spo2', { id: id('sp', day), day, spo2_average: back % 9 === 3 ? null : +(95.5 + rand() * 3).toFixed(3), breathing_disturbance_index: between(0, 3) });

    let daySummary: string | null;
    if (isToday) daySummary = null; // Oura publishes the stress summary once the day is over
    else if (rough) daySummary = 'stressful';
    else daySummary = rand() < 0.2 ? 'restored' : 'normal';
    insert('daily_stress', { id: id('st', day), day, day_summary: daySummary, recovery_high: between(1_800, 7_200), stress_high: between(600, 5_400) });

    for (let hour = 0; hour < 24; hour += 3) insert('heartrate', { timestamp: at(day, hour, 0), bpm: between(50, 95), source: 'awake', day });

    if (!isToday && rand() < 0.35) {
      const start = between(7, 19);
      insert('workouts', {
        id: id('wk', day), day, activity: rand() < 0.7 ? 'walking' : 'cycling',
        calories: +(rand() * 300 + 80).toFixed(1), distance: +(rand() * 6000 + 1500).toFixed(0),
        start_datetime: at(day, start, 5), end_datetime: at(day, start, 47), intensity: 'moderate', source: 'manual',
      });
    }
  }
})();
db.close();

console.log(`demo home ready at ${home} (${DAYS} days of synthetic data through ${today})`);
console.log(`record with:  HOME=${shellQuote(home)} PATH=${shellQuote(join(home, 'bin'))}:"$PATH" vhs assets/demo.tape`);
