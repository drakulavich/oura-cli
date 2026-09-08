import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { requireValue } from '../lib/require-value.js';

export interface TokenResolution {
  token: string | null;
  /** '--token', 'OURA_TOKEN', or the file path that was tried */
  source: string;
}

export function defaultTokenPath(): string {
  return process.env.OURA_TOKEN_PATH ?? resolve(homedir(), '.oura-token');
}

export function resolveToken(explicit?: string, tokenPath?: string): TokenResolution {
  // A blank value is refused rather than ignored: falling back would authenticate as whoever the
  // token file holds, which is not what a caller passing `--token "$VAR"` asked for (#92).
  if (explicit !== undefined) return { token: requireValue(explicit, '--token', 'the token file').trim(), source: '--token' };
  const fromEnv = process.env.OURA_TOKEN;
  if (fromEnv !== undefined) return { token: requireValue(fromEnv, 'OURA_TOKEN', 'the token file').trim(), source: 'OURA_TOKEN' };
  const path = tokenPath ?? defaultTokenPath();
  try {
    return { token: readFileSync(path, 'utf-8').trim(), source: path };
  } catch {
    return { token: null, source: path };
  }
}
