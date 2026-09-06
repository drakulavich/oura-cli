import chalk from 'chalk';
import { padLeft, padRight } from '../lib/pad.js';
import type { DaySummary, TrendRow, DbStats } from '../db/queries.js';
import { COLLECTIONS } from '../collections/index.js';
import type { ImportResult } from '../db/sync.js';
import type { OutputFormat } from '../lib/format-resolve.js';

export type { OutputFormat } from '../lib/format-resolve.js';

function scoreColor(score: number | null): string {
  if (score === null) return chalk.gray('—');
  if (score >= 85) return chalk.green(String(score));
  if (score >= 70) return chalk.yellow(String(score));
  return chalk.red(String(score));
}

function fmtHours(h: number | null): string {
  if (h === null) return chalk.gray('—');
  return `${h}h`;
}

function isEmptyDay(s: DaySummary): boolean {
  return s.sleep_score === null && s.readiness_score === null && s.activity_score === null &&
    s.steps === null && s.stress === null && s.spo2 === null && s.temp_deviation === null &&
    s.sleep_hours === null && s.deep_hours === null && s.rem_hours === null &&
    s.avg_hrv === null && s.lowest_hr === null && s.efficiency === null;
}

export function formatDaySummary(summary: DaySummary, format: OutputFormat, emptyHint?: string): string {
  if (format === 'json') return JSON.stringify(summary, null, 2);

  if (emptyHint && isEmptyDay(summary)) {
    return [
      '',
      chalk.bold(`  ${summary.day}`),
      chalk.gray('─'.repeat(50)),
      `  No Oura data for ${summary.day} yet.`,
      `  ${emptyHint}`,
    ].join('\n');
  }

  const lines: string[] = [
    '',
    chalk.bold(`  ${summary.day}`),
    chalk.gray('─'.repeat(50)),
    `  Sleep:     ${scoreColor(summary.sleep_score)}    Readiness: ${scoreColor(summary.readiness_score)}    Activity: ${scoreColor(summary.activity_score)}`,
    `  Steps:     ${summary.steps ?? chalk.gray('—')}`,
  ];

  if (summary.spo2 !== null) lines.push(`  SpO2:      ${summary.spo2}%`);
  if (summary.temp_deviation !== null) {
    const sign = summary.temp_deviation >= 0 ? '+' : '';
    lines.push(`  Temp:      ${sign}${summary.temp_deviation}°C`);
  }
  if (summary.stress) lines.push(`  Stress:    ${summary.stress}`);

  if (summary.sleep_hours !== null) {
    lines.push('');
    lines.push(`  Sleep:     ${fmtHours(summary.sleep_hours)} total | ${fmtHours(summary.deep_hours)} deep | ${fmtHours(summary.rem_hours)} REM`);
    lines.push(`  HRV:       ${summary.avg_hrv ?? '—'}    Lowest HR: ${summary.lowest_hr ?? '—'}    Efficiency: ${summary.efficiency ?? '—'}%`);
  }

  return lines.join('\n');
}

/** Width to lay text out in: the terminal's when there is one, else the conventional 80. */
export function terminalWidth(): number {
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80;
}

const SUMMARY_INDENT = 4;
const SUMMARY_GAP = 2;
const SUMMARY_MAX_COLUMNS = 4;

/**
 * Lay cells out in as many columns as `width` holds, at most four. Cells are never split:
 * below ~74 columns the old fixed separator wrapped a count onto the next line, so
 * `hr 70 (+0)` read as `hr 7` / `0 (+0)`.
 *
 * `padded` cells all share a width so the columns line up; `bare` cells carry the same text
 * unpadded. In a single column there is nothing to line up with, so the bare cells are used
 * and a narrow terminal gets the shortest line the content allows.
 */
function grid(padded: string[], bare: string[], width: number): string[] {
  const cellWidth = padded[0]?.length ?? 0;
  const fits = Math.floor((width - SUMMARY_INDENT + SUMMARY_GAP) / (cellWidth + SUMMARY_GAP));
  const columns = Math.max(1, Math.min(SUMMARY_MAX_COLUMNS, fits));
  const cells = columns === 1 ? bare : padded;
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += columns) {
    rows.push(' '.repeat(SUMMARY_INDENT) + cells.slice(i, i + columns).join(' '.repeat(SUMMARY_GAP)).trimEnd());
  }
  return rows;
}

export function formatImportSummary(result: ImportResult, width = terminalWidth()): string {
  // "fetched (+new)": re-fetched rows are replaced or ignored, only +new tells whether anything arrived.
  const counts = COLLECTIONS.map(c => ({
    name: c.name,
    fetched: String(result.fetched[c.table] ?? 0),
    added: String(result.added[c.table] ?? 0),
  }));
  const nameW = Math.max(...counts.map(c => c.name.length));
  const fetchedW = Math.max(...counts.map(c => c.fetched.length));
  const cells = counts.map(c => `${c.name.padEnd(nameW)} ${c.fetched.padStart(fetchedW)} (+${c.added})`);
  const cellW = Math.max(...cells.map(c => c.length));
  const bare = counts.map(c => `${c.name} ${c.fetched} (+${c.added})`);
  const head = `  Fetched ${result.startDate} → ${result.endDate}, rows fetched (+new):`;
  return [head, ...grid(cells.map(c => c.padEnd(cellW)), bare, width)].join('\n');
}

export function formatWeekTable(days: DaySummary[], format: OutputFormat, emptyHint?: string): string {
  if (format === 'json') return JSON.stringify(days, null, 2);

  if (emptyHint && days.length > 0 && days.every(isEmptyDay)) {
    return [
      '',
      '  No Oura data for the last 7 days yet.',
      `  ${emptyHint}`,
    ].join('\n');
  }

  const header = `${'Day'.padEnd(12)} ${'Sleep'.padStart(6)} ${'Ready'.padStart(6)} ${'Activity'.padStart(9)} ${'Steps'.padStart(7)} ${'Stress'.padEnd(10)}`;
  const sep = chalk.gray('─'.repeat(56));
  // padLeft, not padStart: scoreColor returns a chalk-wrapped string whose length counts the
  // escapes, so the built-in pads by nothing at all on a colour terminal.
  const rows = days.map(d =>
    `${padRight(d.day, 12)} ${padLeft(scoreColor(d.sleep_score), 6)} ${padLeft(scoreColor(d.readiness_score), 6)} ` +
    `${padLeft(scoreColor(d.activity_score), 9)} ${padLeft(String(d.steps ?? '—'), 7)} ${padRight(d.stress ?? '—', 10)}`
  );
  return ['\n  Last 7 Days', sep, `  ${header}`, sep, ...rows.map(r => `  ${r}`)].join('\n');
}

export function formatTrends(trends: TrendRow[], days: number, format: OutputFormat): string {
  if (format === 'json') return JSON.stringify(trends, null, 2);

  const lines = [
    '',
    chalk.bold(`  Trends: last ${days} days`),
    chalk.gray('─'.repeat(50)),
  ];
  for (const t of trends) {
    lines.push(`  ${t.label.padEnd(15)} avg: ${String(t.avg).padStart(5)}  min: ${String(t.min).padStart(5)}  max: ${String(t.max).padStart(5)}  (${t.count} days)`);
  }
  return lines.join('\n');
}

export function formatStats(stats: DbStats, format: OutputFormat): string {
  if (format === 'json') return JSON.stringify(stats, null, 2);

  const lines = [
    '',
    chalk.bold('  Database Statistics'),
    chalk.gray('═'.repeat(50)),
  ];
  for (const t of stats.tables) {
    lines.push(`  ${t.table.padEnd(22)} ${String(t.rows).padStart(8)} rows`);
  }
  if (stats.dateRange.first) {
    lines.push(`\n  Date range: ${stats.dateRange.first} → ${stats.dateRange.last}`);
  }
  for (const t of stats.trends) {
    lines.push(`  ${t.label.padEnd(15)} avg: ${String(t.avg).padStart(5)}  min: ${String(t.min).padStart(5)}  max: ${String(t.max).padStart(5)}`);
  }
  if (stats.records.mostSteps) {
    lines.push(`\n  Most steps:  ${stats.records.mostSteps.steps} on ${stats.records.mostSteps.day}`);
  }
  if (stats.records.bestSleep) {
    lines.push(`  Best sleep:  ${stats.records.bestSleep.score} on ${stats.records.bestSleep.day}`);
  }
  return lines.join('\n');
}
