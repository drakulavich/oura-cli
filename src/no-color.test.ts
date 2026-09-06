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

  // #80: citty colours its usage output itself and reads NO_COLOR when its module is evaluated,
  // so --no-color used to leave the help screen coloured while NO_COLOR=1 cleaned it.
  it('emits no ANSI escapes in help output with --no-color', async () => {
    const out = await run(['--help', '--no-color'], { NO_COLOR: undefined });
    expect(out).toContain('oura-cli');
    expect(out).not.toMatch(/\u001b\[/);
  });

  it('emits no ANSI escapes in a subcommand help with --no-color', async () => {
    const out = await run(['fetch', '--help', '--no-color'], { NO_COLOR: undefined });
    expect(out).not.toMatch(/\u001b\[/);
  });

  it('emits no ANSI escapes when help is piped and nothing forces colour', async () => {
    const out = await run(['--help'], { NO_COLOR: undefined, FORCE_COLOR: undefined });
    expect(out).not.toMatch(/\u001b\[/);
  });

});
