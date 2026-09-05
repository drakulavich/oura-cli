import type { Database } from '../db/open.js';
import type { TokenResolution } from '../api/token.js';

export type CheckId = 'token' | 'token-valid' | 'database' | 'data';
/** `skip`: the check was not performed (e.g. --offline); it neither passes nor fails. */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

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
