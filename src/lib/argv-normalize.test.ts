import { describe, it, expect } from 'bun:test';
import { normalizeArgv } from './argv-normalize.js';

describe('normalizeArgv', () => {
  it('passes through argv that has no subcommand', () => {
    const argv = ['bun', '/path/index.ts', '--help'];
    expect(normalizeArgv(argv)).toEqual(argv);
  });

  it('moves --format placed before subcommand to after it', () => {
    const argv = ['bun', '/path/index.ts', '--format', 'json', 'sleep', 'today'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'sleep', 'today', '--format', 'json']);
  });

  it('moves --format=value form too', () => {
    const argv = ['bun', '/path/index.ts', '--format=json', 'sleep', 'today'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'sleep', 'today', '--format=json']);
  });

  it('handles boolean flag --no-color before subcommand', () => {
    const argv = ['bun', '/path/index.ts', '--no-color', 'report'];
    expect(normalizeArgv(argv)).toEqual(['bun', '/path/index.ts', 'report', '--no-color']);
  });

  it('leaves flags that are already after the subcommand alone', () => {
    const argv = ['bun', '/path/index.ts', 'sleep', 'today', '--format', 'json'];
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
    const argv = ['bun', '/path/index.ts', '--weird', 'something', 'sleep', 'today'];
    expect(normalizeArgv(argv)).toEqual(argv);
  });
});
