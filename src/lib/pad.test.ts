import { describe, it, expect } from 'bun:test';
import chalk from 'chalk';
import { visibleWidth, padLeft, padRight } from './pad.js';

const coloured = `\u001B[32m83\u001B[39m`;

describe('visibleWidth', () => {
  it('ignores ANSI escapes so a coloured cell measures as its text', () => {
    expect(visibleWidth(coloured)).toBe(2);
    expect(coloured.length).toBeGreaterThan(2);
  });

  it('measures plain text as its length', () => {
    expect(visibleWidth('2026-09-06')).toBe(10);
  });
});

describe('padLeft', () => {
  it('pads a coloured cell to its visible width, unlike padStart', () => {
    expect(visibleWidth(padLeft(coloured, 6))).toBe(6);
    expect(coloured.padStart(6)).toBe(coloured); // the bug this helper exists for
  });

  it('leaves text wider than the column unchanged', () => {
    expect(padLeft('12345', 3)).toBe('12345');
  });

  it('keeps the escapes so the colour survives padding', () => {
    expect(padLeft(coloured, 6)).toContain(coloured);
  });
});

describe('padRight', () => {
  it('pads on the right to the visible width', () => {
    const level = chalk.level;
    chalk.level = 1;
    try {
      const padded = padRight(chalk.red('x'), 4);
      expect(visibleWidth(padded)).toBe(4);
      expect(padded.endsWith('   ')).toBe(true);
    } finally {
      chalk.level = level;
    }
  });
});
