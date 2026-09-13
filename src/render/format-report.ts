import chalk from 'chalk';
import type { ReportData } from '../db/report.js';
import type { OutputFormat } from '../lib/format-resolve.js';
import { padLeft } from '../lib/pad.js';
import { RULE, finish } from './rule.js';

function colorizeScore(n: number): (s: string) => string {
  if (n >= 85) return chalk.green;
  if (n >= 70) return chalk.yellow;
  return chalk.red;
}

function scoreCell(n: number | null, width: number): string {
  if (n === null) return padLeft(chalk.gray('—'), width);
  return padLeft(colorizeScore(n)(String(n)), width);
}

function stepsCell(n: number | null, width: number): string {
  if (n === null) return padLeft(chalk.gray('—'), width);
  return padLeft(n.toLocaleString(), width);
}

function fmtSeconds(s: number | null): string {
  if (s === null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNumber(n: number, isSteps: boolean): string {
  if (isSteps) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toFixed(0);
}

const RECOMMENDATIONS: Record<string, string> = {
  sleep_low: 'Sleep below average — try going to bed 30 min earlier.',
  sleep_great: 'Excellent sleep! Keep it up.',
  readiness_low: 'Low readiness — possible sleep debt. Prioritize recovery.',
  readiness_great: 'Readiness is high! Body is ready for load.',
  steps_low: 'Low movement — aim for 8-10k steps daily.',
  steps_great: 'Great activity! Step goal achieved.',
};

interface WeekBucket {
  weekOf: string;
  /** Days the bucket holds: 7, except the oldest, which takes whatever the window leaves over. */
  days: number;
  avgSleep: number | null;
  avgReadiness: number | null;
  avgActivity: number | null;
  totalSteps: number | null;
  /** Contains a day whose activity is still accumulating; shown as `*` like the weekly rows. */
  partial: boolean;
}

function bucketDaysIntoWeeks(days: ReportData['days']): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  // Chunks of 7 anchored on the newest day, so the remainder is the oldest bucket. Chunked from the
  // oldest day forward, a 30-day window put a 2-day stub at the bottom of the table, where its
  // 9,315 steps beside weeks of 60,000-plus read as activity collapsing (#84).
  for (let end = days.length; end > 0; end -= 7) {
    const chunk = days.slice(Math.max(0, end - 7), end);
    const weekOf = chunk[0].day;

    const sleepVals = chunk.map(d => d.sleep).filter((v): v is number => v !== null);
    const readinessVals = chunk.map(d => d.readiness).filter((v): v is number => v !== null);
    const activityVals = chunk.map(d => d.activity).filter((v): v is number => v !== null);
    const stepsVals = chunk.map(d => d.steps).filter((v): v is number => v !== null);

    buckets.push({
      weekOf,
      days: chunk.length,
      avgSleep: sleepVals.length > 0 ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length : null,
      avgReadiness: readinessVals.length > 0 ? readinessVals.reduce((a, b) => a + b, 0) / readinessVals.length : null,
      avgActivity: activityVals.length > 0 ? activityVals.reduce((a, b) => a + b, 0) / activityVals.length : null,
      totalSteps: stepsVals.length > 0 ? stepsVals.reduce((a, b) => a + b, 0) : null,
      partial: chunk.some(d => d.partial),
    });
  }
  return buckets.reverse();
}

/** The row label: the bucket's first day, its size when short of a week, and the accumulating mark. */
function bucketLabel(b: WeekBucket): string {
  const stub = b.days < 7 ? ` (${b.days} day${b.days === 1 ? '' : 's'})` : '';
  return `${b.weekOf}${stub}${b.partial ? '*' : ''}`;
}

/**
 * One line explaining the `*` mark: which row is not final and how far the activity averages go. The
 * monthly table has no row for a day, so there the note names the bucket that carries the mark. "Not
 * final" rather than "still accumulating": the marked day may be days in the past when the ring has
 * simply not uploaded, and the week table says the same thing in the same words (#72).
 */
function partialDayNote(data: ReportData, bucket: WeekBucket | undefined): string | null {
  const partial = data.days.find(d => d.partial); // the rule yields at most one
  if (!partial) return null;
  const which = bucket ? `the week of ${bucket.weekOf}`
    : partial.day === data.weekEnd ? 'today' : partial.dayLabel;
  const covers = data.completeThrough ? `through ${data.completeThrough}` : 'no complete day yet';
  return `  * ${which}: activity totals are not final; averages cover ${covers}.`;
}

export function formatReport(data: ReportData, format: OutputFormat, period: 'week' | 'month'): string {
  if (format === 'json') return JSON.stringify(data, null, 2);

  const lines: string[] = [];

  // Header
  lines.push('');
  if (period === 'week') {
    lines.push(chalk.bold('  Oura Weekly Report'));
  } else {
    lines.push(chalk.bold('  Oura Monthly Report'));
  }
  lines.push(chalk.gray(`  ${data.weekStart} — ${data.weekEnd}`));
  const buckets = period === 'month' ? bucketDaysIntoWeeks(data.days) : [];
  const note = partialDayNote(data, buckets.find(b => b.partial));
  if (note) lines.push(chalk.yellow(note));
  lines.push('');

  const hasReportData = data.days.some(day =>
    day.sleep !== null || day.readiness !== null || day.activity !== null || day.steps !== null,
  ) || data.averages.length > 0 || data.spo2 !== null || data.sleepDetails !== null;
  if (!hasReportData) {
    lines.push('  No Oura data is available for this report yet.');
    lines.push('  Run `oura-cli sync` to download your data, then run `oura-cli report` again.');
    lines.push('');
    return lines.join('\n');
  }

  if (period === 'week') {
    // Daily table — 7 rows
    lines.push(chalk.bold('  Last 7 Days:'));
    // Rules as wide as the table itself: a fixed 52 sat under a 43-column table (pre-0.8.0 review).
    const table = [RULE, `  ${'Day'.padEnd(10)} ${'Sleep'.padStart(6)} ${'Ready'.padStart(6)} ${'Active'.padStart(7)} ${'Steps'.padStart(8)}`, RULE];
    for (const d of data.days) {
      table.push(`  ${(d.partial ? d.dayLabel + '*' : d.dayLabel).padEnd(10)} ${scoreCell(d.sleep, 6)} ${scoreCell(d.readiness, 6)} ${scoreCell(d.activity, 7)} ${stepsCell(d.steps, 8)}`);
    }
    lines.push(...finish(table), '');
  } else {
    // Monthly — weekly buckets table
    lines.push(chalk.bold('  Last 30 Days:'));
    // 21: a labelled stub is up to 20 characters, "2026-08-13 (2 days)*".
    const table = [RULE, `  ${'Week of'.padEnd(21)} ${'Sleep'.padStart(6)} ${'Ready'.padStart(6)} ${'Active'.padStart(7)} ${'Steps'.padStart(10)}`, RULE];
    for (const b of buckets) {
      const avgSleepInt = b.avgSleep !== null ? Math.round(b.avgSleep) : null;
      const avgReadyInt = b.avgReadiness !== null ? Math.round(b.avgReadiness) : null;
      const avgActiveInt = b.avgActivity !== null ? Math.round(b.avgActivity) : null;
      table.push(`  ${bucketLabel(b).padEnd(21)} ${scoreCell(avgSleepInt, 6)} ${scoreCell(avgReadyInt, 6)} ${scoreCell(avgActiveInt, 7)} ${stepsCell(b.totalSteps, 10)}`);
    }
    lines.push(...finish(table), '');
  }

  // Averages
  lines.push(chalk.bold('  Averages (this period vs previous):'));
  for (const a of data.averages) {
    const avgStr = fmtNumber(a.avg, a.isSteps);
    let changeStr = '';
    if (a.diff !== null) {
      const arrow = a.diff > 0 ? chalk.green('↑') : a.diff < 0 ? chalk.red('↓') : '→';
      const diffStr = a.isSteps ? a.diff.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.diff.toFixed(0);
      changeStr = ` ${arrow} ${a.diff >= 0 ? '+' : ''}${diffStr}`;
    }
    lines.push(`  ${a.label.padEnd(12)} ${chalk.bold(avgStr)}${changeStr}  (min: ${fmtNumber(a.min, a.isSteps)}, max: ${fmtNumber(a.max, a.isSteps)})`);
  }
  if (data.spo2) {
    lines.push(`  ${'SpO2'.padEnd(12)} ${chalk.bold(String(data.spo2.avg) + '%')}  (min: ${data.spo2.min}%, max: ${data.spo2.max}%)`);
  }
  lines.push('');

  // Patterns
  if (data.patterns.lowSleep.length > 0 || data.patterns.lowReadiness.length > 0 || data.patterns.highActivity.length > 0) {
    lines.push(chalk.bold('  Patterns:'));
    for (const d of data.patterns.lowSleep) {
      lines.push(chalk.red(`    ▼ Low sleep: ${d.dayLabel} — ${d.score}`));
    }
    for (const d of data.patterns.lowReadiness) {
      lines.push(chalk.red(`    ▼ Low readiness: ${d.dayLabel} — ${d.score}`));
    }
    for (const d of data.patterns.highActivity) {
      const steps = d.steps !== null ? ` (${d.steps.toLocaleString()} steps)` : '';
      lines.push(chalk.green(`    ▲ High activity: ${d.dayLabel} — ${d.score}${steps}`));
    }
    lines.push('');
  }

  // Sleep details
  if (data.sleepDetails) {
    const sd = data.sleepDetails;
    lines.push(chalk.bold('  Sleep Details (averages):'));
    lines.push(`    Total: ${fmtSeconds(sd.totalSleep)}  Deep: ${fmtSeconds(sd.deepSleep)}  REM: ${fmtSeconds(sd.remSleep)}  Light: ${fmtSeconds(sd.lightSleep)}`);
    lines.push(`    Efficiency: ${sd.efficiency !== null ? sd.efficiency.toFixed(0) + '%' : '—'}  HRV: ${sd.hrv !== null ? sd.hrv.toFixed(0) : '—'}  Lowest HR: ${sd.lowestHr !== null ? sd.lowestHr.toFixed(0) : '—'}`);
    lines.push('');
  }

  // Recommendations
  if (data.recommendations.length > 0) {
    lines.push(chalk.bold('  Recommendations:'));
    for (const key of data.recommendations) {
      lines.push(`    • ${RECOMMENDATIONS[key] ?? key}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
