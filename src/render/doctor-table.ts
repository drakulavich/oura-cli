import chalk from 'chalk';
import { screenWidth } from '../lib/terminal.js';
import { wrap } from '../lib/wrap.js';
import type { CheckStatus, DoctorResult } from './doctor-types.js';
import { RULE, finish } from './rule.js';

function statusSymbol(status: CheckStatus): string {
  if (status === 'ok') return chalk.green('✓');
  if (status === 'warn') return chalk.yellow('!');
  if (status === 'skip') return chalk.gray('–');
  return chalk.red('✗');
}

/** The id column: wide enough for the longest check id, `token-valid`. */
const ID_WIDTH = 12;
/** Columns before a check's detail: indent, symbol, space, the padded id, space. */
const DETAIL_COLUMN = 2 + 1 + 1 + ID_WIDTH + 1;

/**
 * The checks as a table, one row each. A detail is a sentence or two and a `Next:` a command or an
 * instruction; on a terminal both break between words at the screen width and continue under their
 * own text, so a 105-column warning no longer wraps mid-word under the id column (#130).
 */
export function formatDoctorTable(result: DoctorResult, max = screenWidth()): string {
  const lines = ['', chalk.bold('  Doctor'), RULE];
  for (const c of result.checks) {
    lines.push(...wrap(c.detail, max, ' '.repeat(DETAIL_COLUMN), `  ${statusSymbol(c.status)} ${c.id.padEnd(ID_WIDTH)} `));
  }
  lines.push('');
  const next = result.nextStep ?? (result.ok ? 'nothing — everything looks healthy.' : 'see the failing checks above.');
  lines.push(...wrap(next, max, ' '.repeat('  Next: '.length), '  Next: '));
  return finish(lines, max).join('\n');
}
