import chalk from 'chalk';
import { visibleWidth } from '../lib/pad.js';
import { screenWidth } from '../lib/terminal.js';

/** Every text view indents its body by two columns; a rule starts where the body does (#61). */
export const INDENT = '  ';

/**
 * A horizontal rule under a heading: indented like the body it belongs to, and on a terminal never
 * wider than the screen, where a rule that overshoots wraps onto a second line and pushes the table
 * apart. On a pipe nothing wraps, so `width` is drawn in full; `max` overrides the screen width
 * (the tests pass it, since they never run on one). A screen too narrow for a single glyph gets an
 * empty line, not the indent alone: two trailing spaces are not a rule.
 */
export function rule(width: number, glyph = '─', max = screenWidth()): string {
  const drawn = max === undefined ? width : Math.max(0, Math.min(width, max - INDENT.length));
  return drawn === 0 ? '' : chalk.gray(INDENT + glyph.repeat(drawn));
}

/**
 * Placeholders for a rule whose width is the block's own: replaced by `finish()` once every line is
 * known. Printable on purpose, and unindented: every data line a formatter emits starts with INDENT,
 * so no value can collide with them.
 */
const PLACEHOLDER = '<rule ';
export const RULE = `${PLACEHOLDER}─>`;
export const DOUBLE_RULE = `${PLACEHOLDER}═>`;

/**
 * Replace each RULE placeholder in `lines` with a rule as wide as the widest line of the block, so a
 * rule always spans what it delimits. A fixed 50 sat under 63-column trend rows and 54-column stats
 * rows, and on a narrow screen the rows wrapped under a rule that did not.
 */
export function finish(lines: readonly string[], max = screenWidth()): string[] {
  let widest = 0;
  for (const l of lines) if (!l.startsWith(PLACEHOLDER)) widest = Math.max(widest, visibleWidth(l) - INDENT.length);
  return lines.map(l => (l.startsWith(PLACEHOLDER) ? rule(widest, l.slice(PLACEHOLDER.length, -1), max) : l));
}
