import type { Database } from '../lib/db.js';

export type CheckId = 'token' | 'token-valid' | 'database' | 'data';
export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  id: CheckId;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  nextStep: string | null;
}

export interface TokenResolution {
  token: string | null;
  source: string;
}

export interface DoctorDeps {
  resolveToken: () => TokenResolution;
  openDb: () => { db: Database; path: string };
  createClient: (token: string) => { fetch: (endpoint: 'daily_sleep', start: string, end?: string) => Promise<unknown[]> };
  offline: boolean;
  today: string;
}
