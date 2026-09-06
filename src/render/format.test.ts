import { describe, it, expect } from 'bun:test';
import chalk from 'chalk';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats, formatImportSummary } from './format.js';
import type { DaySummary, TrendRow, DbStats } from '../db/queries.js';
import type { ImportResult } from '../db/sync.js';

// Strip ANSI escape codes to assert on *visible* text, regardless of chalk level.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// chalk.level lives on chalk's shared default instance, and other test files mutate it
// (e.g. src/index-flags.test.ts sets it to 0 and never restores it). A file-wide
// beforeAll/afterAll would still leave the colour branches at the mercy of file ordering.
// Instead, force a colour level *only* around the assertions that actually check ANSI
// output, and always restore the previous value — so these tests exercise the
// green/yellow/red/gray branches deterministically no matter how the suite is scheduled,
// and never leak colour state to other files.
function withColor(fn: () => void): void {
  const prev = chalk.level;
  chalk.level = 1;
  try {
    fn();
  } finally {
    chalk.level = prev;
  }
}

function makeDay(overrides: Partial<DaySummary> = {}): DaySummary {
  return {
    day: '2026-05-07',
    sleep_score: 87,
    readiness_score: 74,
    activity_score: 50,
    steps: 9668,
    stress: 'normal',
    spo2: null,
    temp_deviation: null,
    sleep_hours: null,
    deep_hours: null,
    rem_hours: null,
    avg_hrv: null,
    lowest_hr: null,
    efficiency: null,
    ...overrides,
  };
}

describe('formatDaySummary', () => {
  it('returns pretty-printed JSON when format is json', () => {
    const day = makeDay();
    const out = formatDaySummary(day, 'json');
    expect(out).toBe(JSON.stringify(day, null, 2));
  });

  it('renders the day header and a score line in table format', () => {
    const out = stripAnsi(formatDaySummary(makeDay(), 'table'));
    expect(out).toContain('2026-05-07');
    expect(out).toContain('Sleep:');
    expect(out).toContain('Readiness:');
    expect(out).toContain('Activity:');
    expect(out).toContain('Steps:');
  });

  it('colours scores green (>=85), yellow (70-84) and red (<70) by threshold', () => {
    withColor(() => {
      const out = formatDaySummary(
        makeDay({ sleep_score: 85, readiness_score: 70, activity_score: 69 }),
        'table',
      );
      expect(out).toContain(chalk.green('85'));
      expect(out).toContain(chalk.yellow('70'));
      expect(out).toContain(chalk.red('69'));
    });
  });

  it('renders a gray em dash for a null score', () => {
    withColor(() => {
      const out = formatDaySummary(makeDay({ sleep_score: null }), 'table');
      expect(out).toContain(chalk.gray('—'));
    });
  });

  it('renders a gray em dash for null steps but the number for zero steps', () => {
    const nullSteps = stripAnsi(formatDaySummary(makeDay({ steps: null }), 'table'));
    expect(nullSteps).toMatch(/Steps:\s+—/);
    const zeroSteps = stripAnsi(formatDaySummary(makeDay({ steps: 0 }), 'table'));
    expect(zeroSteps).toMatch(/Steps:\s+0/);
  });

  it('shows the SpO2 line only when spo2 is non-null (including 0)', () => {
    expect(stripAnsi(formatDaySummary(makeDay({ spo2: null }), 'table'))).not.toContain('SpO2:');
    expect(stripAnsi(formatDaySummary(makeDay({ spo2: 97 }), 'table'))).toContain('SpO2:      97%');
    // spo2 === 0 is non-null, so it is still rendered.
    expect(stripAnsi(formatDaySummary(makeDay({ spo2: 0 }), 'table'))).toContain('SpO2:      0%');
  });

  it('prefixes a non-negative temperature deviation with + and leaves negatives as-is', () => {
    expect(stripAnsi(formatDaySummary(makeDay({ temp_deviation: 0.3 }), 'table'))).toContain('Temp:      +0.3°C');
    expect(stripAnsi(formatDaySummary(makeDay({ temp_deviation: -0.4 }), 'table'))).toContain('Temp:      -0.4°C');
    // zero is treated as non-negative and gets a + sign.
    expect(stripAnsi(formatDaySummary(makeDay({ temp_deviation: 0 }), 'table'))).toContain('Temp:      +0°C');
    expect(stripAnsi(formatDaySummary(makeDay({ temp_deviation: null }), 'table'))).not.toContain('Temp:');
  });

  it('shows the stress line only when stress is a truthy string', () => {
    expect(stripAnsi(formatDaySummary(makeDay({ stress: 'high' }), 'table'))).toContain('Stress:    high');
    expect(stripAnsi(formatDaySummary(makeDay({ stress: null }), 'table'))).not.toContain('Stress:');
    // empty string is falsy, so the line is omitted.
    expect(stripAnsi(formatDaySummary(makeDay({ stress: '' }), 'table'))).not.toContain('Stress:');
  });

  it('renders the sleep-detail block (hours + HRV line) only when sleep_hours is non-null', () => {
    const withSleep = stripAnsi(
      formatDaySummary(
        makeDay({ sleep_hours: 7.5, deep_hours: 1.2, rem_hours: 1.8, avg_hrv: 45, lowest_hr: 52, efficiency: 91 }),
        'table',
      ),
    );
    expect(withSleep).toContain('7.5h total | 1.2h deep | 1.8h REM');
    expect(withSleep).toContain('HRV:       45');
    expect(withSleep).toContain('Lowest HR: 52');
    expect(withSleep).toContain('Efficiency: 91%');

    const noSleep = stripAnsi(formatDaySummary(makeDay({ sleep_hours: null }), 'table'));
    expect(noSleep).not.toContain('HRV:');
    expect(noSleep).not.toContain('total |');
  });

  it('falls back to em dashes for null HRV / lowest_hr / efficiency inside the sleep block', () => {
    const out = stripAnsi(
      formatDaySummary(
        makeDay({ sleep_hours: 6.0, deep_hours: null, rem_hours: null, avg_hrv: null, lowest_hr: null, efficiency: null }),
        'table',
      ),
    );
    // fmtHours(null) returns a bare em dash (no "h" suffix), unlike a real value.
    expect(out).toContain('6h total | — deep | — REM');
    expect(out).toContain('HRV:       —');
    expect(out).toContain('Lowest HR: —');
    expect(out).toContain('Efficiency: —%');
  });
});

function makeEmptyDay(day: string): DaySummary {
  return {
    day,
    sleep_score: null,
    readiness_score: null,
    activity_score: null,
    steps: null,
    stress: null,
    spo2: null,
    temp_deviation: null,
    sleep_hours: null,
    deep_hours: null,
    rem_hours: null,
    avg_hrv: null,
    lowest_hr: null,
    efficiency: null,
  };
}

describe('formatDaySummary empty state', () => {
  it('shows the empty-state message and hint when every metric is null and a hint is given', () => {
    const out = stripAnsi(formatDaySummary(makeEmptyDay('2026-08-30'), 'table', 'Run `oura-cli sync` to download your data.'));
    expect(out).toContain('2026-08-30');
    expect(out).toContain('No Oura data for 2026-08-30 yet.');
    expect(out).toContain('Run `oura-cli sync` to download your data.');
    expect(out).not.toContain('Sleep:');
    expect(out).not.toContain('Steps:');
  });

  it('ignores the hint in json mode and stays byte-identical to plain JSON.stringify', () => {
    const day = makeEmptyDay('2026-08-30');
    const out = formatDaySummary(day, 'json', 'Run `oura-cli sync` to download your data.');
    expect(out).toBe(JSON.stringify(day, null, 2));
  });

  it('renders the normal dash table for an empty day when no hint is passed', () => {
    const out = stripAnsi(formatDaySummary(makeEmptyDay('2026-08-30'), 'table'));
    expect(out).toContain('Sleep:');
    expect(out).toContain('Steps:');
    expect(out).not.toContain('No Oura data');
  });

  it('renders the normal table when the day has data, even with a hint passed', () => {
    const out = stripAnsi(formatDaySummary(makeDay(), 'table', 'Run `oura-cli sync` to download your data.'));
    expect(out).toContain('Sleep:');
    expect(out).toContain('Steps:');
    expect(out).not.toContain('No Oura data');
  });
});

describe('formatWeekTable', () => {
  it('returns pretty-printed JSON when format is json', () => {
    const days = [makeDay()];
    expect(formatWeekTable(days, 'json')).toBe(JSON.stringify(days, null, 2));
  });

  it('renders a header and one data row per day in table format', () => {
    const out = stripAnsi(formatWeekTable([makeDay({ day: '2026-05-07' }), makeDay({ day: '2026-05-08' })], 'table'));
    expect(out).toContain('Last 7 Days');
    expect(out).toContain('Day');
    expect(out).toContain('2026-05-07');
    expect(out).toContain('2026-05-08');
  });

  it('renders the header even for an empty day list, with no data rows', () => {
    const out = stripAnsi(formatWeekTable([], 'table'));
    expect(out).toContain('Last 7 Days');
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('substitutes em dashes for null steps and null stress in a row', () => {
    const out = stripAnsi(formatWeekTable([makeDay({ steps: null, stress: null })], 'table'));
    // both the steps and stress columns collapse to an em dash.
    expect(out).toContain('—');
  });
});

describe('formatWeekTable empty state', () => {
  it('shows the empty-state message and hint when every day is empty and a hint is given', () => {
    const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'].map(makeEmptyDay);
    const out = stripAnsi(formatWeekTable(days, 'table', 'Run `oura-cli sync`, then `oura-cli db week` again.'));
    expect(out).toContain('No Oura data for the last 7 days yet.');
    expect(out).toContain('Run `oura-cli sync`, then `oura-cli db week` again.');
    expect(out).not.toContain('Day');
  });

  it('renders the normal table when at least one day has data, even with a hint passed', () => {
    const days = [makeEmptyDay('2026-08-29'), makeDay({ day: '2026-08-30' })];
    const out = stripAnsi(formatWeekTable(days, 'table', 'Run `oura-cli sync`, then `oura-cli db week` again.'));
    expect(out).toContain('Last 7 Days');
    expect(out).not.toContain('No Oura data');
  });

  it('renders the normal dash table for all-empty days when no hint is passed', () => {
    const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'].map(makeEmptyDay);
    const out = stripAnsi(formatWeekTable(days, 'table'));
    expect(out).toContain('Last 7 Days');
    expect(out).not.toContain('No Oura data');
  });

  it('renders the header-only table for an empty array, even when a hint is passed', () => {
    const out = stripAnsi(formatWeekTable([], 'table', 'Run `oura-cli sync`, then `oura-cli db week` again.'));
    expect(out).toContain('Last 7 Days');
    expect(out).not.toContain('No Oura data');
  });

  it('ignores the hint in json mode and stays byte-identical to plain JSON.stringify', () => {
    const days = ['2026-08-24', '2026-08-25'].map(makeEmptyDay);
    const out = formatWeekTable(days, 'json', 'Run `oura-cli sync`, then `oura-cli db week` again.');
    expect(out).toBe(JSON.stringify(days, null, 2));
  });
});

describe('formatImportSummary', () => {
  it('defaults a missing collection count to 0 rather than printing undefined', () => {
    const result: ImportResult = {
      startDate: '2026-05-16',
      endDate: '2026-06-15',
      isFirstSync: true,
      fetched: { daily_sleep: 5 },
      added: { daily_sleep: 2 },
    };
    const out = formatImportSummary(result);
    expect(out).toContain('sleep 5 (+2)');
    expect(out).toContain('workout 0 (+0)');
    expect(out).toContain('hr 0 (+0)');
    expect(out).toContain('cv-age 0 (+0)');
    expect(out).toContain('battery 0 (+0)'); // every registry collection is listed
    expect(out).not.toContain('undefined');
  });
});

describe('formatTrends', () => {
  const trends: TrendRow[] = [
    { label: 'Sleep', avg: 80, min: 60, max: 95, count: 7 },
    { label: 'Readiness', avg: 75, min: 65, max: 88, count: 7 },
  ];

  it('returns pretty-printed JSON when format is json', () => {
    expect(formatTrends(trends, 7, 'json')).toBe(JSON.stringify(trends, null, 2));
  });

  it('renders a header naming the window and one line per trend row', () => {
    const out = stripAnsi(formatTrends(trends, 30, 'table'));
    expect(out).toContain('Trends: last 30 days');
    expect(out).toContain('Sleep');
    expect(out).toContain('avg:    80');
    expect(out).toContain('(7 days)');
    expect(out).toContain('Readiness');
  });

  it('renders only the header when there are no trends', () => {
    const out = stripAnsi(formatTrends([], 14, 'table'));
    expect(out).toContain('Trends: last 14 days');
    expect(out).not.toContain('avg:');
  });
});

describe('formatStats', () => {
  function makeStats(overrides: Partial<DbStats> = {}): DbStats {
    return {
      tables: [
        { table: 'daily_sleep', rows: 30 },
        { table: 'daily_activity', rows: 28 },
      ],
      dateRange: { first: '2026-01-01', last: '2026-05-07' },
      trends: [{ label: 'Sleep', avg: 80, min: 60, max: 95, count: 30 }],
      records: {
        mostSteps: { day: '2026-04-01', steps: 15000 },
        bestSleep: { day: '2026-03-15', score: 96 },
      },
      ...overrides,
    };
  }

  it('returns pretty-printed JSON when format is json', () => {
    const stats = makeStats();
    expect(formatStats(stats, 'json')).toBe(JSON.stringify(stats, null, 2));
  });

  it('renders a row for every table with its row count', () => {
    const out = stripAnsi(formatStats(makeStats(), 'table'));
    expect(out).toContain('Database Statistics');
    expect(out).toContain('daily_sleep');
    expect(out).toMatch(/daily_sleep\s+30 rows/);
    expect(out).toMatch(/daily_activity\s+28 rows/);
  });

  it('renders the date-range line only when a first date is present', () => {
    const withRange = stripAnsi(formatStats(makeStats(), 'table'));
    expect(withRange).toContain('Date range: 2026-01-01 → 2026-05-07');

    const noRange = stripAnsi(formatStats(makeStats({ dateRange: { first: null, last: null } }), 'table'));
    expect(noRange).not.toContain('Date range:');
  });

  it('renders record lines only when the corresponding record exists', () => {
    const withRecords = stripAnsi(formatStats(makeStats(), 'table'));
    expect(withRecords).toContain('Most steps:  15000 on 2026-04-01');
    expect(withRecords).toContain('Best sleep:  96 on 2026-03-15');

    const noRecords = stripAnsi(
      formatStats(makeStats({ records: { mostSteps: null, bestSleep: null } }), 'table'),
    );
    expect(noRecords).not.toContain('Most steps:');
    expect(noRecords).not.toContain('Best sleep:');
  });
});
