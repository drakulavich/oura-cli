/**
 * Column padding that measures what the terminal shows, not what the string holds.
 *
 * `String.padStart` counts the ANSI escapes chalk wraps a value in, so padding a coloured
 * cell is a no-op on a colour terminal and correct only when output is piped — which is
 * exactly what the tests see. Pad with these instead of the built-ins.
 */

// The SGR sequences chalk emits (colour, bold, reset); enough for our own output.
const ANSI = /\u001B\[[0-9;]*m/g;

export function visibleWidth(text: string): number {
  return text.replace(ANSI, '').length;
}

/** Right-align `text` in `width` columns; longer text is returned unchanged, as padStart does. */
export function padLeft(text: string, width: number): string {
  const gap = width - visibleWidth(text);
  return gap > 0 ? ' '.repeat(gap) + text : text;
}

/** Left-align `text` in `width` columns; longer text is returned unchanged, as padEnd does. */
export function padRight(text: string, width: number): string {
  const gap = width - visibleWidth(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}
