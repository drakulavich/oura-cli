import type { Database } from '../db/open.js';
import type { TokenResolution } from '../api/token.js';

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

export type { TokenResolution };

export interface DoctorDeps {
  resolveToken: () => TokenResolution;
  openDb: () => { db: Database; path: string };
  createClient: (token: string) => { fetch: (endpoint: 'daily_sleep', query: Record<string, string>) => Promise<unknown[]> };
  offline: boolean;
  today: string;
}
