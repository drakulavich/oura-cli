import { describe, it, expect } from 'bun:test';
import { isVersionRequest, normalizeArgv } from './argv-normalize.js';

describe('normalizeArgv', () => {
  it('passes through argv that has no subcommand', () => {
    const argv = ['bun', '/path/index.ts', '--help'];
    expect(normalizeArgv(argv)).toEqual(argv);
  });

  it('moves --format placed before subcommand to after it', () => {
    const argv = ['bun', '/path/index.ts', '--format', 'json', 'fetch', 'sleep'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'fetch', 'sleep', '--format', 'json']);
  });

  it('moves --format=value form too', () => {
    const argv = ['bun', '/path/index.ts', '--format=json', 'fetch', 'sleep'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'fetch', 'sleep', '--format=json']);
  });

  it('handles boolean flag --no-color before subcommand', () => {
    const argv = ['bun', '/path/index.ts', '--no-color', 'report'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'report', '--no-color']);
  });

  it('leaves flags that are already after the subcommand alone', () => {
    const argv = ['bun', '/path/index.ts', 'fetch', 'sleep', '--format', 'json'];
    expect(normalizeArgv(argv)).toEqual(argv);
  });

  it('hoists multiple flags, preserves their relative order', () => {
    const argv = ['bun', '/path/index.ts', '--format', 'json', '--no-color', 'report', '--period', 'week'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'report', '--period', 'week', '--format', 'json', '--no-color']);
  });

  it('moves --format placed before the doctor subcommand to after it', () => {
    const argv = ['bun', '/path/index.ts', '--format', 'table', 'doctor', '--offline'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'doctor', '--offline', '--format', 'table']);
  });

  it('does not hoist non-global flags placed before the subcommand', () => {
    // Unknown --weird flag should stay where it is (let citty reject it normally).
    const argv = ['bun', '/path/index.ts', '--weird', 'something', 'fetch', 'sleep'];
    expect(normalizeArgv(argv)).toEqual(argv);
  });
});

describe('normalizeArgv and `--`', () => {
  it('keeps hoisted global flags before a `--` separator', () => {
    expect(normalizeArgv(['bun', 's', '--db', 'x', 'db', 'today', '--', 'foo']))
      .toEqual(['bun', 's', 'db', 'today', '--db', 'x', '--', 'foo']);
  });
});

describe('normalizeArgv with a flag between a command and its subcommand', () => {
  // #79: citty resolves a subcommand by the first non-flag token, so the flag's *value* was read
  // as the subcommand name — `db --format json today` failed with Unknown command "json".
  it.each([
    [['bun', 's', 'db', '--format', 'json', 'today'], ['bun', 's', 'db', 'today', '--format', 'json']],
    [['bun', 's', 'db', '--tz', 'UTC', 'week'], ['bun', 's', 'db', 'week', '--tz', 'UTC']],
    [['bun', 's', 'db', '--db', '/tmp/x.db', 'today'], ['bun', 's', 'db', 'today', '--db', '/tmp/x.db']],
    [['bun', 's', 'db', '--format=json', 'today'], ['bun', 's', 'db', 'today', '--format=json']],
    [['bun', 's', 'db', '--no-color', 'today'], ['bun', 's', 'db', 'today', '--no-color']],
  ])('hoists %j', (argv, expected) => {
    expect(normalizeArgv(argv)).toEqual(expected);
  });

  it('hoists flags from both sides at once, keeping the commands in order', () => {
    expect(normalizeArgv(['bun', 's', '--tz', 'UTC', 'db', '--format', 'json', 'today', '--db', 'x']))
      .toEqual(['bun', 's', 'db', 'today', '--tz', 'UTC', '--format', 'json', '--db', 'x']);
  });

  it('leaves a command-specific flag where it is', () => {
    expect(normalizeArgv(['bun', 's', 'fetch', 'sleep', '--day', '2026-09-01']))
      .toEqual(['bun', 's', 'fetch', 'sleep', '--day', '2026-09-01']);
  });

  it('does not touch a global flag name that appears after `--`', () => {
    expect(normalizeArgv(['bun', 's', 'db', 'today', '--', '--format', 'json']))
      .toEqual(['bun', 's', 'db', 'today', '--', '--format', 'json']);
  });
});

describe('isVersionRequest', () => {
  it.each([
    [['--version']],
    [['-v']],
    [['--db', 'x', '--version']],
    [['--no-color', '--version', '--db', 'x']],
  ])('is true for %j', argv => {
    expect(isVersionRequest(argv)).toBe(true);
  });

  it.each([
    [[]],
    [['--db', '--version']],          // --version is the value of --db
    [['--tz', '-v']],
    [['fetch', 'sleep', '--version']], // after a subcommand it is that command's (unknown) flag
    [['fetch', 'sleep', '--day', '--version']],
    [['db', 'today']],
  ])('is false for %j', argv => {
    expect(isVersionRequest(argv)).toBe(false);
  });
});
