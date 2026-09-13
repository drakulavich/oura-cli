import chalk from 'chalk';
import { padLeft, padRight, visibleWidth } from '../lib/pad.js';
import { terminalWidth } from '../lib/terminal.js';
import { rule } from './rule.js';
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
      rule(50),
      `  No Oura data for ${summary.day} yet.`,
      `  ${emptyHint}`,
    ].join('\n');
  }

  // The same `*` the week table and `report` put on this day: without it, drilling from a marked
  // week row into the day lost the mark, though the JSON carried `partial` all along (#113).
  const lines: string[] = [
    '',
    chalk.bold(`  ${summary.partial ? `${summary.day}*` : summary.day}`),
    rule(50),
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
  if (summary.partial) lines.push('', PARTIAL_NOTE);

  return lines.join('\n');
}

/** The one explanation of the `*` mark, shared by the day and week views so they cannot drift apart. */
export const PARTIAL_NOTE = '  * activity totals are not final.';

/**
 * Why today can be empty right after a successful sync. Shared by `db today` and the panel `sync`
 * prints last, which used to show bare dashes with no explanation at all (#61).
 */
export const PUBLISH_DELAY_NOTE = "Oura publishes a day's summary after that night's sleep syncs from the ring.";

const SUMMARY_INDENT = 4;
const SUMMARY_GAP = 2;
const SUMMARY_MAX_COLUMNS = 4;

/**
 * How many columns of `cellWidth` fit in `width`, at most four and always at least one. A cell is
 * never split across lines: below ~74 columns the old fixed separator wrapped a count onto the
 * next line, so `hr 70 (+0)` read as `hr 7` / `0 (+0)`.
 */
function columnsThatFit(cellWidth: number, width: number): number {
  const fits = Math.floor((width - SUMMARY_INDENT + SUMMARY_GAP) / (cellWidth + SUMMARY_GAP));
  return Math.max(1, Math.min(SUMMARY_MAX_COLUMNS, fits));
}

function rowsOf(cells: string[], columns: number): string[] {
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
  const nameW = Math.max(...counts.map(c => visibleWidth(c.name)));
  const fetchedW = Math.max(...counts.map(c => visibleWidth(c.fetched)));
  // Aligned cells share a width, so the name and count columns line up down the grid; bare cells
  // carry the same text at its natural width, which is what a single column wants — there is
  // nothing to line up with, and padding would push a 27-character cell past a 30-column screen.
  const aligned = counts.map(c => `${padRight(c.name, nameW)} ${padLeft(c.fetched, fetchedW)} (+${c.added})`);
  const bare = counts.map(c => `${c.name} ${c.fetched} (+${c.added})`);
  const cellW = Math.max(...aligned.map(visibleWidth));
  const columns = columnsThatFit(cellW, width);
  const cells = columns === 1 ? bare : aligned.map(c => padRight(c, cellW));
  const head = `  Fetched ${result.startDate} → ${result.endDate}, rows fetched (+new):`;
  return [head, ...rowsOf(cells, columns)].join('\n');
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

  // The last column is left unpadded: it lined nothing up and left up to nine trailing spaces on
  // every row (#61).
  const header = `${'Day'.padEnd(12)} ${'Sleep'.padStart(6)} ${'Ready'.padStart(6)} ${'Activity'.padStart(9)} ${'Steps'.padStart(7)} Stress`;
  // padLeft, not padStart: scoreColor returns a chalk-wrapped string whose length counts the
  // escapes, so the built-in pads by nothing at all on a colour terminal.
  // Same mark `report` uses, for the same reason: this day's activity totals are still growing, so
  // its steps are not comparable with the rows above it (#75).
  const rows = days.map(d =>
    `${padRight(d.partial ? `${d.day}*` : d.day, 12)} ${padLeft(scoreColor(d.sleep_score), 6)} ${padLeft(scoreColor(d.readiness_score), 6)} ` +
    `${padLeft(scoreColor(d.activity_score), 9)} ${padLeft(String(d.steps ?? '—'), 7)} ${d.stress ?? '—'}`
  );
  const sep = rule(Math.max(visibleWidth(header), ...rows.map(visibleWidth)));
  const note = days.some(d => d.partial) ? [PARTIAL_NOTE] : [];
  return ['\n  Last 7 Days', sep, `  ${header}`, sep, ...rows.map(r => `  ${r}`), ...note].join('\n');
}

export function formatTrends(trends: TrendRow[], days: number, format: OutputFormat, emptyHint?: string): string {
  if (format === 'json') return JSON.stringify(trends, null, 2);

  const lines = [
    '',
    chalk.bold(`  Trends: last ${days} days`),
    rule(50),
  ];
  // A header over nothing read like a crash (#85); say what is missing, as the day and week views do.
  if (emptyHint && trends.length === 0) lines.push(`  No Oura data for the last ${days} days yet.`, `  ${emptyHint}`);
  for (const t of trends) {
    lines.push(`  ${t.label.padEnd(15)} avg: ${String(t.avg).padStart(5)}  min: ${String(t.min).padStart(5)}  max: ${String(t.max).padStart(5)}  (${t.count} days)`);
  }
  return lines.join('\n');
}

export function formatStats(stats: DbStats, format: OutputFormat, emptyHint?: string): string {
  if (format === 'json') return JSON.stringify(stats, null, 2);

  const lines = [
    '',
    chalk.bold('  Database Statistics'),
    rule(50, '═'),
  ];
  // Seventeen lines of "0 rows" said the same thing less clearly (#85).
  if (emptyHint && stats.tables.every(t => t.rows === 0)) {
    return [...lines, '  No Oura data in the database yet.', `  ${emptyHint}`].join('\n');
  }
  // Both names, as the sync lines print them: one collection was reaching the user under three names
  // in a single session — `sleep-periods` in the summary, `sleep_model` here (#72).
  for (const t of stats.tables) {
    lines.push(`  ${`${t.collection} (${t.table})`.padEnd(38)} ${String(t.rows).padStart(8)} row${t.rows === 1 ? '' : 's'}`);
  }
  // Counts alone do not say why the sections below are missing: a cache holding only battery samples
  // has rows but no days, and printed seventeen counts and nothing else (#72). Only when there is
  // nothing below to contradict it: `dateRange` reads sleep alone, and a first sync before the night's
  // sleep summary has activity trends and a steps record to show.
  const noDailyData = stats.dateRange.first === null && stats.trends.length === 0
    && stats.records.mostSteps === null && stats.records.bestSleep === null;
  if (emptyHint && noDailyData) lines.push('', '  No daily summaries in the database yet.', `  ${emptyHint}`);
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
