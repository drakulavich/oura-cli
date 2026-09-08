import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { resolveToken } from './token.js';
import { CliError } from '../lib/errors.js';

const file = resolve(tmpdir(), `oura-token-${process.pid}`);
const saved = { OURA_TOKEN: process.env.OURA_TOKEN, OURA_TOKEN_PATH: process.env.OURA_TOKEN_PATH };

beforeEach(() => { delete process.env.OURA_TOKEN; process.env.OURA_TOKEN_PATH = '/nonexistent/oura-token'; });
afterEach(() => {
  rmSync(file, { force: true });
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('resolveToken', () => {
  it('prefers the explicit token and reports --token as the source', () => {
    process.env.OURA_TOKEN = 'env';
    expect(resolveToken('  explicit ')).toEqual({ token: 'explicit', source: '--token' });
  });
  it('falls back to OURA_TOKEN', () => {
    process.env.OURA_TOKEN = 'env-tok';
    expect(resolveToken()).toEqual({ token: 'env-tok', source: 'OURA_TOKEN' });
  });
  it('reads the token file and reports its path', () => {
    writeFileSync(file, 'file-tok\n');
    expect(resolveToken(undefined, file)).toEqual({ token: 'file-tok', source: file });
  });
  it('returns null with the attempted path when nothing is available', () => {
    expect(resolveToken(undefined, file)).toEqual({ token: null, source: file });
  });

  // #92: the same shape as #76. A blank value fell through to the token file, so a wrapper
  // expanding an unset variable authenticated as whoever that file holds.
  it.each([[''], ['   ']])('rejects a blank --token (%j) instead of using the token file', value => {
    writeFileSync(file, 'file-tok\n');
    let err: unknown;
    try { resolveToken(value, file); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('BAD_ARGS');
    expect((err as CliError).message).toContain('--token');
  });

  it('rejects an empty OURA_TOKEN rather than ignoring it', () => {
    process.env.OURA_TOKEN = '';
    let err: unknown;
    try { resolveToken(undefined, file); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toContain('OURA_TOKEN');
  });

  it('never puts the value itself in the error', () => {
    let err: unknown;
    try { resolveToken('   ', file); } catch (e) { err = e; }
    expect(`${(err as CliError).message} ${(err as CliError).hint}`).not.toMatch(/ {3}/);
  });
});
