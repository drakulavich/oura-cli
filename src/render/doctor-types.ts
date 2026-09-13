import type { Database } from '../db/open.js';
import type { TokenResolution } from '../api/token.js';

export type CheckId = 'token' | 'token-valid' | 'database' | 'integrity' | 'data';
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
  createClient: (token: string) => { fetch: (endpoint: 'daily_sleep' | 'daily_readiness' | 'daily_activity', query: Record<string, string>) => Promise<unknown[]> };
  offline: boolean;
  /** YYYY-MM-DD in `tz`; the day the live token probe asks for. */
  today: string;
  /** The instant the checks run at (ISO 8601 UTC); the data check measures staleness from it. */
  now: string;
  /** Timezone the cache's days are bounded in; a day ends at its local midnight. */
  tz: string;
}
