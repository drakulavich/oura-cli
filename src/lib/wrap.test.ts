import { describe, it, expect } from 'bun:test';
import chalk from 'chalk';
import { wrap } from './wrap.js';

describe('wrap (#130)', () => {
  const hint = 'Run `oura-cli sync` to download your data. Oura publishes a summary after the night syncs.';

  it('breaks between words so that no line is wider than the width, indent included', () => {
    const lines = wrap(hint, 40, '  ');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(l.length).toBeLessThanOrEqual(40);
      expect(l.startsWith('  ')).toBe(true);
    }
    expect(lines.map(l => l.trim()).join(' ')).toBe(hint);
  });

  it('keeps a backticked command whole, spaces and clinging punctuation included', () => {
    const lines = wrap('Run `oura-cli sync` (`sync --from <day>` for older days), or `oura-cli fetch tags` to read the API.', 30, '  ');
    for (const l of lines) {
      expect(l.length).toBeLessThanOrEqual(30);
      expect((l.match(/`/g) ?? []).length % 2).toBe(0);
    }
    expect(lines.some(l => l.includes('(`sync --from <day>`'))).toBe(true);
  });

  it('leaves a single line when the width is undefined, as on a pipe', () => {
    expect(wrap(hint, undefined, '  ')).toEqual([`  ${hint}`]);
  });

  it('gives the first line its own prefix and the rest the indent, both counted against the width', () => {
    const lines = wrap('one two three four five six', 15, '        ', '  hint: ');
    expect(lines[0]).toBe('  hint: one two');
    expect(lines[1]).toBe('        three');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(15);
  });

  it('puts a word wider than the room on a line of its own rather than dropping it', () => {
    expect(wrap('a /very/long/path/that/does/not/fit b', 12, '')).toEqual(['a', '/very/long/path/that/does/not/fit', 'b']);
  });

  it('yields no lines for empty or blank text, so a prefix never stands alone as trailing whitespace', () => {
    expect(wrap('', 40, '  ', '  hint: ')).toEqual([]);
    expect(wrap('   ', 40, '  ')).toEqual([]);
  });

  it('measures colour escapes at zero width', () => {
    const coloured = `${chalk.red('error')} ${chalk.red('again')}`;
    expect(wrap(coloured, 11, '')).toEqual([coloured]);
  });
});
