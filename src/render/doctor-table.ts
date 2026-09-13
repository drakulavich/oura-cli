import chalk from 'chalk';
import type { CheckStatus, DoctorResult } from './doctor-types.js';
import { RULE, finish } from './rule.js';

function statusSymbol(status: CheckStatus): string {
  if (status === 'ok') return chalk.green('✓');
  if (status === 'warn') return chalk.yellow('!');
  if (status === 'skip') return chalk.gray('–');
  return chalk.red('✗');
}

export function formatDoctorTable(result: DoctorResult): string {
  const lines = ['', chalk.bold('  Doctor'), RULE];
  for (const c of result.checks) {
    lines.push(`  ${statusSymbol(c.status)} ${c.id.padEnd(12)} ${c.detail}`);
  }
  lines.push('');
  const next = result.nextStep ?? (result.ok ? 'nothing — everything looks healthy.' : 'see the failing checks above.');
  lines.push(`  Next: ${next}`);
  return finish(lines).join('\n');
}
