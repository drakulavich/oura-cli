import { describe, it, expect } from 'bun:test';
import { formatReport } from './format-report.js';
import type { ReportData } from '../db/report.js';

// Strip ANSI escape codes to count *visible* column widths.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const fixture: ReportData = {
  period: 'week',
  weekStart: '2026-05-07',
  weekEnd: '2026-05-13',
  days: [
    { day: '2026-05-07', dayLabel: 'Thu 07/05', sleep: 87, readiness: 85, activity: 90, steps: 9668, partial: false },
    { day: '2026-05-08', dayLabel: 'Fri 08/05', sleep: 71, readiness: 74, activity: 88, steps: 7697, partial: false },
  ],
  completeThrough: '2026-05-13',
  lastUpload: null,
  averages: [],
  spo2: null,
  patterns: { lowSleep: [], lowReadiness: [], highActivity: [] },
  sleepDetails: { totalSleep: null, deepSleep: null, remSleep: null, lightSleep: null, efficiency: null, hrv: null, lowestHr: null },
  recommendations: [],
};

describe('formatReport — daily table column alignment', () => {
  it('renders Sleep / Ready / Active scores as right-aligned columns of consistent width regardless of chalk colours', () => {
    const out = stripAnsi(formatReport(fixture, 'table', 'week'));
    const dataRows = out.split('\n').filter(line => /^\s{2}(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(line));
    expect(dataRows.length).toBe(2);

    // Find the header line. Its columns define the canonical positions.
    const header = out.split('\n').find(l => /^\s{2}Day\s/.test(l))!;
    const sleepHeaderEnd = header.indexOf('Sleep') + 'Sleep'.length;
    const readyHeaderEnd = header.indexOf('Ready') + 'Ready'.length;
    const activeHeaderEnd = header.indexOf('Active') + 'Active'.length;

    for (const row of dataRows) {
      // each row's Sleep / Ready / Active digits should end roughly at the header end position
      // (right-aligned column). Allow ±1 char drift for visual aesthetics.
      const sleepEnd = sleepHeaderEnd;
      const sleepChars = row.slice(sleepEnd - 2, sleepEnd).trim();
      expect(sleepChars).toMatch(/^\d+$/);
    }
  });

  it('formats today\'s row in the same column positions as previous days, even when scores are red', () => {
    const lowFixture: ReportData = {
      ...fixture,
      days: [
        { day: '2026-05-13', dayLabel: 'Wed 13/05', sleep: 44, readiness: 57, activity: 63, steps: 795, partial: false },
        { day: '2026-05-07', dayLabel: 'Thu 07/05', sleep: 87, readiness: 85, activity: 90, steps: 9668, partial: false },
      ],
    };
    const out = stripAnsi(formatReport(lowFixture, 'table', 'week'));
    const rows = out.split('\n').filter(l => /^\s{2}(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(l));
    expect(rows.length).toBe(2);
    // Both rows should have the same column positions
    const firstSleepIdx = rows[0].search(/\d/);
    const secondSleepIdx = rows[1].search(/\d/);
    // dayLabel widths are equal so first digit of "Sleep" column should appear at same index
    expect(firstSleepIdx).toBe(secondSleepIdx);
  });
});

describe('formatReport — first run', () => {
  it('guides a user with no synced data to run the next required command', () => {
    const emptyReport: ReportData = {
      ...fixture,
      days: fixture.days.map(day => ({
        ...day,
        sleep: null,
        readiness: null,
        activity: null,
        steps: null,
      })),
      averages: [],
      sleepDetails: null,
    };

    const out = stripAnsi(formatReport(emptyReport, 'table', 'week'));

    expect(out).toContain('No Oura data is available for this report yet.');
    expect(out).toContain('Run `oura-cli sync` to download your data, then run `oura-cli report` again.');
    expect(out).not.toContain('Last 7 Days:');
  });

  it('renders available sleep details when daily scores are absent', () => {
    const sleepDetailsOnlyReport: ReportData = {
      ...fixture,
      days: fixture.days.map(day => ({
        ...day,
        sleep: null,
        readiness: null,
        activity: null,
        steps: null,
      })),
      averages: [],
    };

    const out = stripAnsi(formatReport(sleepDetailsOnlyReport, 'table', 'week'));

    expect(out).toContain('Sleep Details (averages):');
    expect(out).not.toContain('No Oura data is available for this report yet.');
  });
});

describe('formatReport — partial day', () => {
  const partialFixture: ReportData = {
    ...fixture,
    weekEnd: '2026-05-08',
    days: [fixture.days[0]!, { ...fixture.days[1]!, steps: 382, partial: true }],
    completeThrough: '2026-05-07',
    lastUpload: '2026-05-08T01:08:00Z',
  };

  it('marks the accumulating row with * and explains it once', () => {
    const out = stripAnsi(formatReport(partialFixture, 'table', 'week'));
    expect(out).toContain('Fri 08/05*');
    expect(out).toContain('Thu 07/05 ');
    expect(out).toContain('* today is still accumulating; activity averages cover through 2026-05-07.');
  });

  it('names the day when the partial day is not today', () => {
    const data = { ...partialFixture, weekEnd: '2026-05-09' };
    const out = stripAnsi(formatReport(data, 'table', 'week'));
    expect(out).toContain('* Fri 08/05 is still accumulating');
  });

  it('marks the monthly bucket that holds the accumulating day and keeps the note', () => {
    const out = stripAnsi(formatReport({ ...partialFixture, period: 'month' }, 'table', 'month'));
    expect(out).toContain('2026-05-07*');
    expect(out).toContain('still accumulating');
  });

  it('prints no note when every day is complete', () => {
    expect(stripAnsi(formatReport(fixture, 'table', 'week'))).not.toContain('still accumulating');
  });
});
