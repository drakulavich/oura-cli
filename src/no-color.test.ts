import { describe, it, expect } from 'bun:test';

async function run(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
    stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '1', ...env } as Record<string, string>,
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe('--no-color / NO_COLOR', () => {
  it('emits no ANSI escapes with NO_COLOR=1', async () => {
    const out = await run(['--db', ':memory:', 'db', 'today', '--format', 'table'], { NO_COLOR: '1' });
    expect(out).not.toMatch(/\u001b\[/);
  });
  it('emits no ANSI escapes with --no-color', async () => {
    const out = await run(['--db', ':memory:', '--no-color', 'db', 'today', '--format', 'table'], { NO_COLOR: undefined });
    expect(out).not.toMatch(/\u001b\[/);
  });
});
