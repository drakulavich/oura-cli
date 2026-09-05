import { describe, it, expect } from 'bun:test';

async function run(...argv: string[]) {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', ':memory:', ...argv], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

describe('db date', () => {
  it('rejects a calendar-invalid date with BAD_ARGS before querying', async () => {
    const { stdout, stderr, code } = await run('db', 'date', '2026-02-30', '--format', 'json');
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error.code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('accepts a real date and returns the (empty) day summary', async () => {
    const { stdout, code } = await run('db', 'date', '2026-06-15', '--format', 'json');
    expect(code).toBe(0);
    expect(JSON.parse(stdout).day).toBe('2026-06-15');
  });
});

describe('db trends', () => {
  it.each(['abc', '0', '1.5'])('rejects a window of %j with BAD_ARGS', async days => {
    const { stdout, stderr, code } = await run('db', 'trends', days, '--format', 'json');
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error.code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('accepts a positive window', async () => {
    const { stdout, code } = await run('db', 'trends', '7', '--format', 'json');
    expect(code).toBe(0);
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  });
});
