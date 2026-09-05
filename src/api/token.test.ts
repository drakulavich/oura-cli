import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { resolveToken } from './token.js';

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
});
