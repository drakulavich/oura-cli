import chalk from 'chalk';
import { padLeft, padRight, visibleWidth } from '../lib/pad.js';
import { screenWidth } from '../lib/terminal.js';
import { wrap } from '../lib/wrap.js';
import type { AnyCollection, SqlValue } from '../collections/index.js';
import type { CachedRow } from '../db/rows.js';
import type { OutputFormat } from '../lib/format-resolve.js';
import { INDENT, RULE, finish } from './rule.js';

/** Longest cell in the table view. JSON blobs such as `contributors` are cut here; the JSON output keeps them whole. */
export const MAX_CELL = 40;
/** A value column is never squeezed below this to make the table fit the screen; a header is never squeezed at all. */
export const MIN_CELL = 8;
const GAP = 2;

/**
 * A cell's text: `—` for NULL, and no control characters. `tags.comment` is free user text, and a
 * newline in it broke the row while a tab shifted every column after it; a newline shows as ⏎ and
 * any other control character as a space. The JSON output carries the value untouched.
 */
function printable(value: SqlValue): string {
  if (value === null) return '—';
  return String(value).replace(/\r\n|\r|\n/g, '⏎').replace(/[\u0000-\u001f\u007f]/g, ' ');
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

/** The widest of `values`, by a loop: a spread over a year of heart rate overflowed the call stack. */
function widest(values: Iterable<number>, floor = 0): number {
  let out = floor;
  for (const v of values) if (v > out) out = v;
  return out;
}

/**
 * Shrink the widest value columns, one character at a time, until the table fits `available`. A
 * column stops at its floor: MIN_CELL, or its header, since a header cut to `tempera…` no longer
 * says which of two temperature columns it is. Null when even that does not fit.
 */
function fit(natural: readonly number[], floors: readonly number[], available: number): number[] | null {
  const out = [...natural];
  while (out.reduce((sum, w) => sum + w, 0) > available) {
    let target = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i]! > floors[i]! && (target === -1 || out[i]! > out[target]!)) target = i;
    }
    if (target === -1) return null;
    out[target]!--;
  }
  return out;
}

/** One block per row, `name  value` per line: what a 19-column table becomes on an 80-column screen. */
function records(names: readonly string[], texts: readonly string[][], max: number | undefined): string[] {
  const nameW = widest(names.map(visibleWidth));
  const valueW = max === undefined ? Number.POSITIVE_INFINITY : Math.max(MIN_CELL, max - INDENT.length - nameW - GAP);
  const lines: string[] = [];
  texts.forEach((row, r) => {
    if (r > 0) lines.push('');
    names.forEach((name, i) => lines.push(`${INDENT}${padRight(name, nameW)}${' '.repeat(GAP)}${clip(row[i]!, valueW)}`.trimEnd()));
  });
  return lines;
}

/**
 * The cached rows of one collection: one column per stored column, numbers right-aligned, text
 * left, nothing padded past the last cell. `scope` is the range the rows were asked for (" for
 * 2026-09-01 → 2026-09-07"), empty for a snapshot collection; `total` is how many rows the range
 * holds when `rows` is a `--limit` prefix of them. On a terminal (`max` columns) the value columns
 * are squeezed first, and when the headers alone would not fit, each row is printed as a block of
 * `name  value` lines instead: a table that wraps under a rule two thirds its width is not a table.
 * On a pipe nothing wraps and every cell keeps up to MAX_CELL. Every rule spans the block (#73).
 */
export function formatRows(
  c: AnyCollection, rows: CachedRow[], scope: string, format: OutputFormat, emptyHint: string,
  max = screenWidth(), total = rows.length,
): string {
  if (format === 'json') return JSON.stringify(rows, null, 2);

  const all = Math.max(total, rows.length);
  const count = rows.length === all ? `${all} row${all === 1 ? '' : 's'}` : `${rows.length} of ${all} rows`;
  const title = chalk.bold(`  ${c.name} (${c.table}): ${count}${scope}`);
  if (rows.length === 0) {
    return finish(['', title, RULE, `  No cached ${c.name} rows${scope}.`, ...wrap(emptyHint, max, INDENT)], max).join('\n');
  }

  const names = c.columns.map(k => k.name);
  const numeric = new Set(c.columns.filter(k => k.type !== 'TEXT').map(k => k.name));
  const texts = rows.map(r => names.map(name => clip(printable(r[name] ?? null), MAX_CELL)));
  const headers = names.map(visibleWidth);
  const natural = names.map((_, i) => widest(texts.map(row => visibleWidth(row[i]!)), headers[i]!));
  const gaps = GAP * (names.length - 1);
  const widths = max === undefined ? natural : fit(natural, headers.map(h => Math.max(h, MIN_CELL)), max - INDENT.length - gaps);
  if (widths === null) return finish(['', title, RULE, ...records(names, texts, max)], max).join('\n');

  const line = (parts: string[]) =>
    `${INDENT}${parts.map((p, i) => (numeric.has(names[i]!) ? padLeft(clip(p, widths[i]!), widths[i]!) : padRight(clip(p, widths[i]!), widths[i]!))).join(' '.repeat(GAP))}`.trimEnd();
  return finish(['', title, RULE, line(names), RULE, ...texts.map(line)], max).join('\n');
}
