import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { formatFromArgv } from './lib/format-resolve.js';

const ENTRY = join(import.meta.dir, 'index.ts');

// End-to-end through src/index.ts: everything here is piped (no TTY), so errors must be
// a single JSON envelope on stderr with nothing on stdout.
async function run(...argv: string[]) {
  const proc = Bun.spawn(['bun', 'run', ENTRY, '--db', ':memory:', ...argv], { stdout: 'pipe', stderr: 'pipe', cwd: join(import.meta.dir, '..') });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

function envelope(stderr: string) {
  const lines = stderr.trim().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!).error as { code: string; message: string; hint?: string };
}

describe('errors raised before a command runs', () => {
  it('unknown command → BAD_ARGS envelope, empty stdout, exit 1, no ANSI', async () => {
    const { stdout, stderr, code } = await run('bogus-cmd', '--format', 'json');
    expect(stdout).toBe('');
    expect(stderr).not.toContain('\u001b');
    const e = envelope(stderr);
    expect(e.code).toBe('BAD_ARGS');
    expect(e.message).toBe('Unknown command "bogus-cmd".');
    expect(code).toBe(1);
  });

  it.each([
    [['db', 'reset'], 'sync'],
    [['db', 'import'], 'sync'],
    [['hr', 'today'], 'fetch <collection>'],
    [['sleep', 'week'], 'fetch <collection>'],
  ])('removed command %j points at its replacement', async (argv, expected) => {
    const { stdout, stderr, code } = await run(...argv);
    expect(stdout).toBe('');
    expect(envelope(stderr).hint).toContain(expected);
    expect(code).toBe(1);
  });

  it('missing positional → BAD_ARGS naming the argument', async () => {
    const { stdout, stderr, code } = await run('fetch');
    expect(stdout).toBe('');
    expect(envelope(stderr).message).toContain('COLLECTION');
    expect(code).toBe(1);
  });

  it('no command on a pipe → BAD_ARGS with a --help hint', async () => {
    const { stdout, stderr, code } = await run();
    expect(stdout).toBe('');
    expect(envelope(stderr).hint).toContain('--help');
    expect(code).toBe(1);
  });

  it('--help and --version still render through citty', async () => {
    const help = await run('--help');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('fetch');
    // run() prepends --db, so this also proves --version works next to other flags.
    const version = await run('--version');
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('undeclared arguments end to end', () => {
  it('fetch sleep --dayz 7 → BAD_ARGS instead of today\'s data', async () => {
    const { stdout, stderr, code } = await run('fetch', 'sleep', '--dayz', '7');
    expect(stdout).toBe('');
    expect(envelope(stderr).message).toContain('--dayz');
    expect(code).toBe(1);
  });

  it('db trends -5 → BAD_ARGS instead of the 30-day default', async () => {
    const { stdout, stderr, code } = await run('db', 'trends', '-5');
    expect(stdout).toBe('');
    expect(envelope(stderr).message).toContain('-5');
    expect(code).toBe(1);
  });

  it('--version in a value position is a bad value, not a version request', async () => {
    const { stdout, stderr, code } = await run('fetch', 'sleep', '--day', '--version');
    expect(stdout).toBe('');
    expect(envelope(stderr).code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it.each([
    [['healthcheck', '--bogus', 'extra']],
    [['describe', '--bogus']],
    [['manifest', 'extra']],
  ])('commands outside the runner reject undeclared arguments too: %j', async argv => {
    const { stdout, stderr, code } = await run(...argv);
    expect(stdout).toBe('');
    expect(envelope(stderr).code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('describe and manifest still accept the global flags the normaliser hoists onto them', async () => {
    const { stdout, code } = await run('--format', 'json', 'describe');
    expect(code).toBe(0);
    expect(JSON.parse(stdout).commands.length).toBeGreaterThan(5);
  });

  it('a prototype member is an unknown command, not a silent exit 0', async () => {
    const { stdout, stderr, code } = await run('constructor');
    expect(stdout).toBe('');
    expect(envelope(stderr).message).toBe('Unknown command "constructor".');
    expect(code).toBe(1);
  });

  it('positionals after `--` are reported as typed, without the hoisted global flags', async () => {
    const { stderr } = await run('db', 'today', '--', 'foo');
    const e = envelope(stderr);
    expect(e.message).toContain('foo');
    expect(e.message).not.toContain('--db');
  });

  it('a global flag after the subcommand is still accepted', async () => {
    const { stdout, code } = await run('db', 'today', '--format', 'json', '--no-color');
    expect(code).toBe(0);
    expect(JSON.parse(stdout).day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatFromArgv', () => {
  it('honours a valid explicit --format in either spelling', () => {
    expect(formatFromArgv(['db', '--format', 'json'], true)).toBe('json');
    expect(formatFromArgv(['--format=table', 'db'], false)).toBe('table');
  });
  it('falls back to the TTY default when --format is missing or invalid', () => {
    expect(formatFromArgv(['db'], true)).toBe('table');
    expect(formatFromArgv(['db'], false)).toBe('json');
    expect(formatFromArgv(['--format', 'yaml'], false)).toBe('json');
  });
  it('does not read --format out of another flag\'s value position', () => {
    expect(formatFromArgv(['--token', '--format', 'db'], true)).toBe('table');
  });
});
