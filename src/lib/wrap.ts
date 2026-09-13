import { visibleWidth } from './pad.js';

/**
 * Break one line of prose into lines no wider than `width`. The first line starts with `first`,
 * the rest with `indent`, so a hint can continue under its own text or under a label. Breaks fall
 * between words only, and a backticked span counts as one word, so neither a path nor a command
 * like `oura-cli sync --from <day>` is ever split; a word wider than the room gets a line to
 * itself. `width` undefined means a pipe, where nothing wraps (#130). Runs of whitespace collapse
 * to one space either way, and empty text yields no lines at all rather than a bare prefix.
 */
/** A backticked span with whatever punctuation clings to it, or a run of non-spaces. */
const WORD = /\S*`[^`]*`\S*|\S+/g;

export function wrap(text: string, width: number | undefined, indent = '', first = indent): string[] {
  const words = text.match(WORD);
  if (words === null) return [];
  const lines: string[] = [];
  let prefix = first;
  let line = '';
  for (const word of words) {
    if (line === '') { line = word; continue; }
    const room = width === undefined ? Infinity : width - visibleWidth(prefix);
    if (visibleWidth(line) + 1 + visibleWidth(word) <= room) { line += ` ${word}`; continue; }
    lines.push(prefix + line);
    prefix = indent;
    line = word;
  }
  lines.push(prefix + line);
  return lines;
}
