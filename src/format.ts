import chalk from 'chalk';
import type { DaySummary, TrendRow, DbStats } from './db/queries.js';
import type { ImportResult } from './db/import.js';
import type { OutputFormat } from './lib/format-resolve.js';

export type { OutputFormat } from './lib/format-resolve.js';

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

export function formatImportSummary(result: ImportResult): string {
  const c = result.counts;
  return [
    `  Imported ${result.startDate} → ${result.endDate}:`,
    `    sleep ${c.daily_sleep ?? 0}   readiness ${c.daily_readiness ?? 0}   activity ${c.daily_activity ?? 0}   sleep periods ${c.sleep_model ?? 0}`,
    `    spo2 ${c.daily_spo2 ?? 0}    stress ${c.daily_stress ?? 0}      workouts ${c.workouts ?? 0}   heart rate ${c.heartrate ?? 0}   cardiovascular age ${c.cardiovascular_age ?? 0}`,
  ].join('\n');
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
  const rows = days.map(d =>
    `${d.day.padEnd(12)} ${scoreColor(d.sleep_score).padStart(6)} ${scoreColor(d.readiness_score).padStart(6)} ` +
    `${scoreColor(d.activity_score).padStart(9)} ${String(d.steps ?? '—').padStart(7)} ${(d.stress ?? '—').padEnd(10)}`
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
