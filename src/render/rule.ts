import chalk from 'chalk';
import { screenWidth } from '../lib/terminal.js';

/** Every text view indents its body by two columns; a rule starts where the body does (#61). */
export const INDENT = '  ';

/**
 * A horizontal rule under a heading: indented like the body it belongs to, and on a terminal never
 * wider than the screen, where a rule that overshoots wraps onto a second line and pushes the table
 * apart. On a pipe nothing wraps, so `width` is drawn in full; `max` overrides the screen width
 * (the tests pass it, since they never run on one).
 */
export function rule(width: number, glyph = '─', max = screenWidth()): string {
  const drawn = max === undefined ? width : Math.max(0, Math.min(width, max - INDENT.length));
  return chalk.gray(INDENT + glyph.repeat(drawn));
}
