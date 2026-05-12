import { describe, it, expect, afterEach } from 'bun:test';
import { readFileSync, statSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { writeToken } from './login.js';

const tmpPath = resolve(tmpdir(), `oura-token-test-${process.pid}-${Math.random().toString(36).slice(2)}`);

afterEach(() => {
  try { rmSync(tmpPath, { force: true }); } catch {}
});

describe('writeToken', () => {
  it('writes the token to disk', () => {
    writeToken(tmpPath, 'abc-123');
    expect(readFileSync(tmpPath, 'utf-8')).toBe('abc-123');
  });

  it('rejects empty / whitespace tokens', () => {
    expect(() => writeToken(tmpPath, '   ')).toThrow(/empty/i);
  });

  it('sets owner-only permissions on POSIX', () => {
    if (process.platform === 'win32') return;
    writeToken(tmpPath, 'abc-123');
    const mode = statSync(tmpPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
