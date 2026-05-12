import chalk from 'chalk';
import type { WeeklyReportData } from './db/report.js';
import type { OutputFormat } from './lib/format-resolve.js';

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

export function formatWeeklyReport(data: WeeklyReportData, format: OutputFormat): string {
  if (format === 'json') return JSON.stringify(data, null, 2);

  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold('  Oura Weekly Report'));
  lines.push(chalk.gray(`  ${data.weekStart} — ${data.weekEnd}`));
  lines.push('');

  // Daily table
  lines.push(chalk.bold('  Last 7 Days:'));
  lines.push(chalk.gray('  ' + '─'.repeat(52)));
  lines.push(`  ${'Day'.padEnd(10)} ${'Sleep'.padStart(6)} ${'Ready'.padStart(6)} ${'Active'.padStart(7)} ${'Steps'.padStart(8)}`);
  lines.push(chalk.gray('  ' + '─'.repeat(52)));
  for (const d of data.days) {
    const sleep = d.sleep !== null ? (d.sleep >= 85 ? chalk.green(String(d.sleep)) : d.sleep >= 70 ? chalk.yellow(String(d.sleep)) : chalk.red(String(d.sleep))) : chalk.gray('—');
    const ready = d.readiness !== null ? (d.readiness >= 85 ? chalk.green(String(d.readiness)) : d.readiness >= 70 ? chalk.yellow(String(d.readiness)) : chalk.red(String(d.readiness))) : chalk.gray('—');
    const active = d.activity !== null ? (d.activity >= 85 ? chalk.green(String(d.activity)) : d.activity >= 70 ? chalk.yellow(String(d.activity)) : chalk.red(String(d.activity))) : chalk.gray('—');
    const steps = d.steps !== null ? d.steps.toLocaleString() : chalk.gray('—');
    lines.push(`  ${d.dayLabel.padEnd(10)} ${sleep.padStart(6)} ${ready.padStart(6)} ${active.padStart(7)} ${steps.padStart(8)}`);
  }
  lines.push('');

  // Averages
  lines.push(chalk.bold('  Averages (this week vs previous):'));
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
