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

describe('db rows (#73)', () => {
  it('rejects an unknown collection with the valid list', async () => {
    const { stdout, stderr, code } = await run('db', 'rows', 'bogus', '--format', 'json');
    expect(stdout).toBe('');
    const e = JSON.parse(stderr).error;
    expect(e.code).toBe('BAD_ARGS');
    expect(e.message).toBe('Unknown collection "bogus".');
    expect(e.hint).toContain('tags');
    expect(code).toBe(1);
  });

  it('rejects range flags for the ring snapshot, like fetch does', async () => {
    const { stderr, code } = await run('db', 'rows', 'ring', '--day', '2026-06-15', '--format', 'json');
    expect(JSON.parse(stderr).error.message).toContain('snapshot');
    expect(code).toBe(1);
  });

  it('rejects a bad --days before touching the cache', async () => {
    const { stderr, code } = await run('db', 'rows', 'tags', '--days', '0', '--format', 'json');
    expect(JSON.parse(stderr).error.code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('returns an empty array for an empty cache in JSON, and an explanation in text', async () => {
    const json = await run('db', 'rows', 'tags', '--days', '7', '--format', 'json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual([]);

    const text = await run('db', 'rows', 'ring', '--format', 'table');
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('ring (ring_configuration): 0 rows');
    expect(text.stdout).toContain('No cached ring rows.');
    expect(text.stdout).toContain('oura-cli fetch ring');
  });
});
