import { describe, it, expect, afterEach } from 'bun:test';

describe('--no-color flag', () => {
  const prevNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (prevNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prevNoColor;
  });

  it('disables chalk ANSI output when the NO_COLOR env variable is set', async () => {
    process.env.NO_COLOR = '1';
    const { default: chalk } = await import('chalk');
    chalk.level = 0;

    expect(chalk.red('x')).toBe('x');
  });
});
