import { openDatabase, ensureSchema, getDbPath } from '../db/open.js';
import type { Database } from '../db/open.js';
import { OuraClient } from '../api/client.js';
import { resolveToken } from '../api/token.js';
import { CliError, exitCodeFor } from '../lib/errors.js';
import { formatDoctorTable } from '../render/doctor-table.js';
import { dataCommand, type Ctx, type Output } from './run-command.js';
import type { CheckStatus, DoctorCheck, DoctorResult, DoctorDeps } from '../render/doctor-types.js';

export type { CheckId, CheckStatus, DoctorCheck, DoctorResult, DoctorDeps, TokenResolution } from '../render/doctor-types.js';

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
    checks.push({ id: 'token-valid', status: 'skip', detail: 'Not checked (--offline).' });
  } else {
    try {
      const client = deps.createClient(token);
      await client.fetch('daily_sleep', { start_date: deps.today, end_date: deps.today });
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
    // `healthcheck` only proves the file opens; corruption inside a b-tree is invisible to it and
    // to every read command until one happens to touch the damaged page (#78). quick_check walks
    // the pages without the cross-index work of integrity_check: 11 ms against 42 ms on a 7.5 MB
    // cache, which is what a month of heart rate looks like.
    const damage = quickCheck(db);
    checks.push(damage === null
      ? { id: 'integrity', status: 'ok', detail: 'Database passes SQLite quick_check.' }
      : { id: 'integrity', status: 'fail', detail: `Database is damaged: ${damage}`, fix: 'Delete the cache file (--db / OURA_DB_PATH) and run `oura-cli sync` to rebuild it.' });

    // A damaged file answers a query with an exception; the integrity check above has already
    // said so, and doctor must still finish rather than crash on its way to the summary.
    let last: string | null = null;
    let readFailed: string | undefined;
    try {
      last = latestDataDay(db);
    } catch (err) {
      readFailed = err instanceof Error ? err.message : String(err);
    }
    if (readFailed !== undefined) {
      checks.push({ id: 'data', status: 'fail', detail: `Cannot read the cache: ${readFailed}`, fix: 'Delete the cache file (--db / OURA_DB_PATH) and run `oura-cli sync` to rebuild it.' });
    } else if (!last) {
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
    checks.push({ id: 'integrity', status: 'fail', detail: 'Cannot check integrity — database unavailable.' });
    checks.push({ id: 'data', status: 'fail', detail: 'Cannot check data — database unavailable.' });
  }

  db?.close();

  // A later check's fix is only trustworthy if every earlier check passed —
  // otherwise it may recommend a command blocked by the same root cause
  // (e.g. suggesting `sync` when token-valid already found the API
  // unreachable). So nextStep takes the first non-ok check's fix, not the
  // first *fix* among non-ok checks.
  const settled = (s: string) => s === 'ok' || s === 'skip';
  const ok = checks.every(c => settled(c.status));
  const nextStep = checks.find(c => !settled(c.status))?.fix ?? null;
  return { ok, checks, nextStep };
}

/** The first problem `PRAGMA quick_check` reports, or null when the file is intact. */
function quickCheck(db: Database): string | null {
  try {
    const rows = db.query('PRAGMA quick_check(1)').all() as Array<Record<string, string>>;
    const first = rows[0] === undefined ? 'ok' : Object.values(rows[0])[0] ?? 'ok';
    return first === 'ok' ? null : first;
  } catch (err) {
    // A file too damaged to answer the pragma is exactly what this check is for.
    return err instanceof Error ? err.message : String(err);
  }
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
  // Everything else is about the database: 'database' itself, 'integrity', and 'data', which only
  // fails when 'database' already did — and 'database' sorts first, so it is the one reported.
  return exitCodeFor(new CliError('DB_ERROR', fail.detail));
}

export async function runDoctor(ctx: Ctx, args: { db?: string; token?: string; offline?: boolean }): Promise<Output> {
  // Resolved before the checks run: a malformed --db is an argument error, and reporting it as
  // `database: fail` would hide a typo behind a health finding and exit 4 instead of 1.
  const dbPath = getDbPath(args.db);
  const deps: DoctorDeps = {
    resolveToken: () => resolveToken(args.token),
    openDb: () => {
      const db = openDatabase(args.db);
      ensureSchema(db);
      return { db, path: dbPath };
    },
    createClient: (token: string) => new OuraClient({ token }),
    offline: args.offline === true,
    today: ctx.today,
  };
  const result = await runChecks(deps);
  return {
    json: result,
    text: () => formatDoctorTable(result),
    exitCode: exitCodeForChecks(result.checks),
  };
}

export const doctorCommand = dataCommand({
  meta: { name: 'doctor', description: 'Diagnose token, database, and sync health, and suggest the next step.' },
  args: { offline: { type: 'boolean', default: false, description: 'Skip the live Oura API token-validation call' } },
  run: (ctx, args) => runDoctor(ctx, {
    db: args.db as string | undefined,
    token: args.token as string | undefined,
    offline: args.offline === true,
  }),
});
