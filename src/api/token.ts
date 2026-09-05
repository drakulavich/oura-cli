import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

export interface TokenResolution {
  token: string | null;
  /** '--token', 'OURA_TOKEN', or the file path that was tried */
  source: string;
}

export function defaultTokenPath(): string {
  return process.env.OURA_TOKEN_PATH ?? resolve(homedir(), '.oura-token');
}

export function resolveToken(explicit?: string, tokenPath?: string): TokenResolution {
  if (explicit) return { token: explicit.trim(), source: '--token' };
  if (process.env.OURA_TOKEN) return { token: process.env.OURA_TOKEN.trim(), source: 'OURA_TOKEN' };
  const path = tokenPath ?? defaultTokenPath();
  try {
    return { token: readFileSync(path, 'utf-8').trim(), source: path };
  } catch {
    return { token: null, source: path };
  }
}
