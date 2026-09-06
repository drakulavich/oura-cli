import { describe, it, expect } from 'bun:test';

// citty suppresses its own colours when `NO_COLOR=1`, `TERM=dumb`, `TEST` or `CI` is set
// (node_modules/citty/dist/index.mjs). GitHub Actions sets CI, so a child that inherits the
// runner's environment never colours anything and an "emits no ANSI" assertion passes whether
// or not the fix is there. Unset those and give the child a colour-capable TERM, so these tests
// fail if `src/index.ts` stops importing the colour module first.
async function run(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', ...args], {
    stdout: 'pipe', stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '1', CI: undefined, TEST: undefined, TERM: 'xterm-256color',
      ...env,
    } as unknown as Record<string, string>, // undefined removes the key, which is the point here
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
  // The decision itself is pinned in src/lib/color-mode.test.ts; these run the real CLI.
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

  // The control for the three cases above: without it they would pass on a renderer that never
  // colours anything, which is exactly what CI used to give us.
  it('colours help when FORCE_COLOR asks for it, so the absence tests mean something', async () => {
    const out = await run(['--help'], { NO_COLOR: undefined });
    expect(out).toMatch(/\u001b\[/);
  });

});
