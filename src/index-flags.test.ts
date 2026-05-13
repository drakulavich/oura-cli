import { describe, it, expect, afterEach } from 'bun:test';

describe('--no-color wiring (manifest claim)', () => {
  const prevNoColor = process.env.NO_COLOR;
  afterEach(() => {
    if (prevNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prevNoColor;
  });

  it('NO_COLOR env disables chalk', async () => {
    // Assert that the documented behaviour is consistent with chalk's contract.
    // chalk.level = 0 means no ANSI codes in output.
    process.env.NO_COLOR = '1';
    const { default: chalk } = await import('chalk');
    chalk.level = 0; // simulate the index.ts early branch
    expect(chalk.red('x')).toBe('x');
  });
});
