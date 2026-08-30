import { defineCommand } from 'citty';
import { resolve } from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import type { Database } from '../lib/db.js';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { OuraClient } from '../api/client.js';
import { CliError, exitCodeFor } from '../lib/errors.js';
import { todayDate } from './helpers.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { commonArgs, handleError, applyNoColor } from './common.js';

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

export async function runChecks(deps: DoctorDeps): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  const { token, source } = deps.resolveToken();
  if (token) {
    checks.push({ id: 'token', status: 'ok', detail: `Token found via ${source}.` });
  } else {
    checks.push({ id: 'token', status: 'fail', detail: `No token found (checked ${source}).`, fix: 'oura-cli login' });
  }

  if (!token) {
    checks.push({ id: 'token-valid', status: 'fail', detail: 'No token to validate.', fix: 'oura-cli login' });
  } else if (deps.offline) {
    checks.push({ id: 'token-valid', status: 'ok', detail: 'Skipped (--offline).' });
  } else {
    try {
      const client = deps.createClient(token);
      await client.fetch('daily_sleep', deps.today, deps.today);
      checks.push({ id: 'token-valid', status: 'ok', detail: 'Token accepted by the Oura API.' });
    } catch (err) {
      if (err instanceof CliError && err.code === 'TOKEN_INVALID') {
        checks.push({ id: 'token-valid', status: 'fail', detail: err.message, fix: 'oura-cli login' });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({ id: 'token-valid', status: 'warn', detail: `Could not reach the Oura API: ${msg}` });
      }
    }
  }

  let db: Database | null = null;
  try {
    const opened = deps.openDb();
    db = opened.db;
    checks.push({ id: 'database', status: 'ok', detail: `Database ready at ${opened.path}.` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ id: 'database', status: 'fail', detail: msg });
  }

  if (db) {
    const last = latestDataDay(db);
    if (!last) {
      checks.push({ id: 'data', status: 'warn', detail: 'No data in the local cache yet.', fix: 'oura-cli sync' });
    } else {
      const ageDays = Math.round(
        (new Date(`${deps.today}T00:00:00Z`).getTime() - new Date(`${last}T00:00:00Z`).getTime()) / 86400000,
      );
      if (ageDays > 2) {
        checks.push({ id: 'data', status: 'warn', detail: `Most recent data is from ${last} (${ageDays} days ago).`, fix: 'oura-cli sync' });
      } else {
        checks.push({ id: 'data', status: 'ok', detail: `Data current through ${last}.` });
      }
    }
  } else {
    checks.push({ id: 'data', status: 'fail', detail: 'Cannot check data — database unavailable.' });
  }

  const ok = checks.every(c => c.status !== 'fail');
  const nextStep = checks.find(c => c.status !== 'ok' && c.fix)?.fix ?? null;
  return { ok, checks, nextStep };
}

const DATA_TABLES = ['daily_sleep', 'daily_readiness', 'daily_activity'] as const;

function latestDataDay(db: Database): string | null {
  let latest: string | null = null;
  for (const tbl of DATA_TABLES) {
    const row = db.query(`SELECT MAX(day) as d FROM ${tbl}`).get() as { d: string | null } | undefined;
    if (row?.d && (!latest || row.d > latest)) latest = row.d;
  }
  return latest;
}

export function exitCodeForChecks(checks: DoctorCheck[]): number {
  const fail = checks.find(c => c.status === 'fail');
  if (!fail) return 0;
  if (fail.id === 'token' || fail.id === 'token-valid') return exitCodeFor(new CliError('TOKEN_MISSING', fail.detail));
  if (fail.id === 'database') return exitCodeFor(new CliError('DB_ERROR', fail.detail));
  return 1;
}

function statusSymbol(status: CheckStatus): string {
  if (status === 'ok') return chalk.green('✓');
  if (status === 'warn') return chalk.yellow('!');
  return chalk.red('✗');
}

export function formatDoctorTable(result: DoctorResult): string {
  const lines = ['', chalk.bold('  Doctor'), chalk.gray('─'.repeat(50))];
  for (const c of result.checks) {
    lines.push(`  ${statusSymbol(c.status)} ${c.id.padEnd(12)} ${c.detail}`);
  }
  lines.push('');
  const next = result.nextStep ?? (result.ok ? 'nothing — everything looks healthy.' : 'see the failing checks above.');
  lines.push(`  Next: ${next}`);
  return lines.join('\n');
}

export function resolveTokenLikeClient(explicitToken?: string): TokenResolution {
  if (explicitToken) return { token: explicitToken.trim(), source: '--token' };
  if (process.env.OURA_TOKEN) return { token: process.env.OURA_TOKEN.trim(), source: 'OURA_TOKEN' };
  const tokenPath = process.env.OURA_TOKEN_PATH ?? resolve(homedir(), '.oura-token');
  try {
    return { token: readFileSync(tokenPath, 'utf-8').trim(), source: tokenPath };
  } catch {
    return { token: null, source: tokenPath };
  }
}

export const doctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Diagnose token, database, and sync health, and suggest the next step.' },
  args: {
    ...commonArgs,
    offline: { type: 'boolean', default: false, description: 'Skip the live Oura API token-validation call' },
  },
  async run({ args }) {
    applyNoColor(args);
    try {
      const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
      const deps: DoctorDeps = {
        resolveToken: () => resolveTokenLikeClient(args.token as string | undefined),
        openDb: () => {
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          return { db, path: getDbPath({ dbPath: args.db }) };
        },
        createClient: (token: string) => new OuraClient({ token }),
        offline: args.offline === true,
        today: todayDate(args.tz),
      };
      const result = await runChecks(deps);
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatDoctorTable(result));
      }
      process.exit(exitCodeForChecks(result.checks));
    } catch (err) {
      handleError(err, args);
    }
  },
});
