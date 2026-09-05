import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from './open.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// csv-import.ts hard-codes its source directory at module-load time from
// `process.env.HOME`:
//   CSV_DIR = <HOME>/Documents/OpenClaw/projects/oura-ring/data/App Data
// To exercise it we point HOME at a temp sandbox *before* importing the module
// (the const is captured once, on first import) and drive real semicolon-
// delimited CSV files through it into a real bun:sqlite database.
const ORIGINAL_HOME = process.env.HOME;
const HOME = join(tmpdir(), `oura-csv-home-${Date.now()}`);
const CSV_DIR = join(HOME, 'Documents/OpenClaw/projects/oura-ring/data/App Data');
process.env.HOME = HOME;

const { importFromCSV } = await import('./csv-import.js');

function resetDir(): void {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(CSV_DIR, { recursive: true });
}

function writeCsv(name: string, content: string): void {
  writeFileSync(join(CSV_DIR, name), content);
}

function newDb(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

function collectLogs(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}

describe('csv-import importFromCSV', () => {
  beforeEach(() => {
    resetDir();
  });

  afterAll(() => {
    rmSync(HOME, { recursive: true, force: true });
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
  });

  it('throws when the CSV source directory does not exist', () => {
    rmSync(HOME, { recursive: true, force: true }); // remove the dir entirely
    const db = newDb();
    const { log } = collectLogs();
    expect(() => importFromCSV(db, log)).toThrow(/CSV directory not found/);
    db.close();
  });

  it('imports nothing but still completes when the directory has no CSV files', () => {
    const db = newDb();
    const { log, lines } = collectLogs();

    importFromCSV(db, log);

    // Every table stays empty; each per-table log reports 0 rows.
    const count = (t: string) => (db.query(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    expect(count('daily_sleep')).toBe(0);
    expect(count('heartrate')).toBe(0);
    expect(lines).toContain('daily_sleep: 0 rows');
    expect(lines).toContain('CSV import complete.');
    db.close();
  });

  it('parses a semicolon-delimited row and maps header columns onto db columns', () => {
    writeCsv('dailysleep.csv',
      'id;day;score;contributors;timestamp\n' +
      's1;2026-03-05;80;{"deep":90};2026-03-05T00:00:00Z\n');
    const db = newDb();
    const { log, lines } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT * FROM daily_sleep WHERE id = ?').get('s1') as
      { id: string; day: string; score: number; contributors: string; timestamp: string };
    expect(row).toEqual({
      id: 's1', day: '2026-03-05', score: 80,
      contributors: '{"deep":90}', timestamp: '2026-03-05T00:00:00Z',
    });
    expect(lines).toContain('daily_sleep: 1 rows');
    db.close();
  });

  it('maps empty and non-numeric numeric cells to null via num()', () => {
    // score is empty; steps is non-numeric — both land as NULL, not 0/NaN.
    writeCsv('dailyactivity.csv',
      'id;day;score;active_calories;steps;equivalent_walking_distance;high_activity_time;' +
      'medium_activity_time;low_activity_time;sedentary_time;total_calories;target_calories;' +
      'contributors;timestamp\n' +
      'a1;2026-03-05;;500;abc;100;10;20;30;40;2000;2500;{};2026-03-05T00:00:00Z\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT score, steps, active_calories FROM daily_activity WHERE id = ?')
      .get('a1') as { score: number | null; steps: number | null; active_calories: number | null };
    expect(row.score).toBeNull();
    expect(row.steps).toBeNull();
    expect(row.active_calories).toBe(500);
    db.close();
  });

  it('maps an empty text cell to null via str()', () => {
    writeCsv('dailysleep.csv',
      'id;day;score;contributors;timestamp\n' +
      's1;2026-03-05;80;;2026-03-05T00:00:00Z\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT contributors FROM daily_sleep WHERE id = ?').get('s1') as
      { contributors: string | null };
    expect(row.contributors).toBeNull();
    db.close();
  });

  it('imports nothing from a header-only file (needs at least 2 lines)', () => {
    writeCsv('dailysleep.csv', 'id;day;score;contributors;timestamp\n');
    const db = newDb();
    const { log, lines } = collectLogs();

    importFromCSV(db, log);

    const c = (db.query('SELECT COUNT(*) AS c FROM daily_sleep').get() as { c: number }).c;
    expect(c).toBe(0);
    expect(lines).toContain('daily_sleep: 0 rows');
    db.close();
  });

  it('skips blank lines between rows', () => {
    writeCsv('dailysleep.csv',
      'id;day;score;contributors;timestamp\n' +
      '\n' +
      's1;2026-03-05;80;{};2026-03-05T00:00:00Z\n' +
      '   \n' +
      's2;2026-03-06;85;{};2026-03-06T00:00:00Z\n');
    const db = newDb();
    const { log, lines } = collectLogs();

    importFromCSV(db, log);

    const c = (db.query('SELECT COUNT(*) AS c FROM daily_sleep').get() as { c: number }).c;
    expect(c).toBe(2);
    expect(lines).toContain('daily_sleep: 2 rows');
    db.close();
  });

  it('fills missing trailing columns with null when a row has fewer values than headers', () => {
    // Row stops after `score`; contributors and timestamp are absent entirely.
    writeCsv('dailysleep.csv',
      'id;day;score;contributors;timestamp\n' +
      's1;2026-03-05;80\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT score, contributors, timestamp FROM daily_sleep WHERE id = ?')
      .get('s1') as { score: number; contributors: string | null; timestamp: string | null };
    expect(row.score).toBe(80);
    expect(row.contributors).toBeNull();
    expect(row.timestamp).toBeNull();
    db.close();
  });

  it('upserts on primary key so a duplicate id in the same file keeps the last row (INSERT OR REPLACE)', () => {
    writeCsv('dailysleep.csv',
      'id;day;score;contributors;timestamp\n' +
      's1;2026-03-05;80;{};2026-03-05T00:00:00Z\n' +
      's1;2026-03-05;95;{};2026-03-05T00:00:00Z\n');
    const db = newDb();
    const { log, lines } = collectLogs();

    importFromCSV(db, log);

    const c = (db.query('SELECT COUNT(*) AS c FROM daily_sleep').get() as { c: number }).c;
    expect(c).toBe(1);
    const row = db.query('SELECT score FROM daily_sleep WHERE id = ?').get('s1') as { score: number };
    expect(row.score).toBe(95);
    // The log still reports the raw parsed row count (2), not the stored count (1).
    expect(lines).toContain('daily_sleep: 2 rows');
    db.close();
  });

  it('extracts the average out of the spo2_percentage JSON blob', () => {
    writeCsv('dailyspo2.csv',
      'id;day;spo2_percentage;breathing_disturbance_index\n' +
      'sp1;2026-03-05;{"average": 99.046};1.2\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT spo2_average, breathing_disturbance_index FROM daily_spo2 WHERE id = ?')
      .get('sp1') as { spo2_average: number; breathing_disturbance_index: number };
    expect(row.spo2_average).toBe(99.046);
    expect(row.breathing_disturbance_index).toBe(1.2);
    db.close();
  });

  it('stores a null spo2 average when the spo2_percentage blob is malformed JSON (parse is swallowed)', () => {
    writeCsv('dailyspo2.csv',
      'id;day;spo2_percentage;breathing_disturbance_index\n' +
      'sp1;2026-03-05;not-json;1.2\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT spo2_average FROM daily_spo2 WHERE id = ?').get('sp1') as
      { spo2_average: number | null };
    expect(row.spo2_average).toBeNull();
    db.close();
  });

  it('stores a null spo2 average when the JSON blob lacks an "average" key', () => {
    writeCsv('dailyspo2.csv',
      'id;day;spo2_percentage;breathing_disturbance_index\n' +
      'sp1;2026-03-05;{"min": 90};1.2\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT spo2_average FROM daily_spo2 WHERE id = ?').get('sp1') as
      { spo2_average: number | null };
    expect(row.spo2_average).toBeNull();
    db.close();
  });

  it('derives heartrate.day from the timestamp and dedups on (timestamp, source) via INSERT OR IGNORE', () => {
    // Two rows share (timestamp, source); OR IGNORE keeps the first (bpm 60).
    writeCsv('heartrate.csv',
      'timestamp;bpm;source\n' +
      '2026-03-05T10:00:00Z;60;awake\n' +
      '2026-03-05T10:00:00Z;72;awake\n' +
      '2026-03-05T11:00:00Z;65;awake\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const rows = db.query('SELECT timestamp, bpm, source, day FROM heartrate ORDER BY timestamp')
      .all() as { timestamp: string; bpm: number; source: string; day: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ timestamp: '2026-03-05T10:00:00Z', bpm: 60, source: 'awake', day: '2026-03-05' });
    expect(rows[1].day).toBe('2026-03-05');
    db.close();
  });

  it('stores an empty workout label as null (the CSV path uses str(), unlike importDaily which coerces to "")', () => {
    // FINDING (characterization, not fixed here): the two import paths disagree
    // on empty workout labels. import.ts (API sync) coerces a null label to '';
    // csv-import.ts runs it through str() and stores NULL instead.
    writeCsv('workout.csv',
      'id;day;activity;calories;distance;start_datetime;end_datetime;intensity;label;source\n' +
      'w1;2026-03-05;walking;100;1.5;2026-03-05T10:00:00Z;2026-03-05T10:30:00Z;easy;;manual\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT label FROM workouts WHERE id = ?').get('w1') as { label: string | null };
    expect(row.label).toBeNull();
    db.close();
  });

  it('drops the last column when the file uses CRLF line endings (trailing \\r sticks to the last header key)', () => {
    // FINDING (characterization, not fixed here): parseCSV splits on '\n' only,
    // so with CRLF the last header becomes "timestamp\r" and the last value
    // carries a trailing "\r". Reading r.timestamp (key "timestamp") misses, so
    // the timestamp is stored as NULL — a real Oura export using CRLF would
    // silently lose its last column.
    writeCsv('dailysleep.csv',
      'id;day;score;contributors;timestamp\r\n' +
      's1;2026-03-05;80;{};2026-03-05T00:00:00Z\r\n');
    const db = newDb();
    const { log } = collectLogs();

    importFromCSV(db, log);

    const row = db.query('SELECT score, timestamp FROM daily_sleep WHERE id = ?').get('s1') as
      { score: number; timestamp: string | null };
    expect(row.score).toBe(80);        // non-terminal columns are unaffected
    expect(row.timestamp).toBeNull();  // the terminal column is lost to the stray \r
    db.close();
  });
});
