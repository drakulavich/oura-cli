import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from '../db/database.js';
import { CliError } from '../lib/errors.js';
import {
  runChecks, exitCodeForChecks, formatDoctorTable, resolveTokenLikeClient,
  type DoctorDeps, type DoctorCheck,
} from './doctor.js';

function makeDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  const db = new Database(':memory:');
  ensureSchema(db);
  return {
    resolveToken: () => ({ token: 'secret-token-value', source: 'OURA_TOKEN' }),
    openDb: () => ({ db, path: ':memory:' }),
    createClient: () => ({ fetch: async () => [] }),
    offline: true,
    today: '2026-08-30',
    ...overrides,
  };
}

describe('doctor runChecks', () => {
  it('flags a missing token as fail with a login next step', async () => {
    const result = await runChecks(makeDeps({
      resolveToken: () => ({ token: null, source: 'no OURA_TOKEN, no ~/.oura-token' }),
    }));

    const tokenCheck = result.checks.find(c => c.id === 'token')!;
    expect(tokenCheck.status).toBe('fail');
    expect(tokenCheck.fix).toBe('oura-cli login');
    expect(result.ok).toBe(false);
    expect(result.nextStep).toBe('oura-cli login');
  });

  it('warns when the database has no data yet, points at sync, and does not report ok', async () => {
    const result = await runChecks(makeDeps());

    const dataCheck = result.checks.find(c => c.id === 'data')!;
    expect(dataCheck.status).toBe('warn');
    expect(dataCheck.fix).toBe('oura-cli sync');
    expect(result.nextStep).toBe('oura-cli sync');
    // A warning means something is genuinely worth the user's attention —
    // `ok` must not claim a clean bill of health while one is present.
    expect(result.ok).toBe(false);
  });

  it('warns when the most recent data is more than two days stale', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)')
      .run('id1', '2026-08-25', 80, '{}', '2026-08-25T00:00:00Z');

    const result = await runChecks(makeDeps({ openDb: () => ({ db, path: ':memory:' }) }));

    const dataCheck = result.checks.find(c => c.id === 'data')!;
    expect(dataCheck.status).toBe('warn');
    expect(result.nextStep).toBe('oura-cli sync');
  });

  it('reports all-ok with no next step when the token, db, and data are all healthy', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query('INSERT OR REPLACE INTO daily_sleep VALUES (?,?,?,?,?)')
      .run('id1', '2026-08-30', 80, '{}', '2026-08-30T00:00:00Z');

    const result = await runChecks(makeDeps({ openDb: () => ({ db, path: ':memory:' }) }));

    expect(result.checks.every(c => c.status === 'ok')).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.nextStep).toBeNull();
  });

  it('treats a network/API error during token validation as a warning, not a failure', async () => {
    const result = await runChecks(makeDeps({
      offline: false,
      createClient: () => ({ fetch: async () => { throw new Error('fetch failed'); } }),
    }));

    const tokenValid = result.checks.find(c => c.id === 'token-valid')!;
    expect(tokenValid.status).toBe('warn');
  });

  it('fails token validation on an explicit TOKEN_INVALID error and points at login', async () => {
    const result = await runChecks(makeDeps({
      offline: false,
      createClient: () => ({
        fetch: async () => { throw new CliError('TOKEN_INVALID', 'Oura API 401: unauthorized'); },
      }),
    }));

    const tokenValid = result.checks.find(c => c.id === 'token-valid')!;
    expect(tokenValid.status).toBe('fail');
    expect(tokenValid.fix).toBe('oura-cli login');
    expect(result.nextStep).toBe('oura-cli login');
  });

  it('skips the live API call when offline is set', async () => {
    let called = false;
    const result = await runChecks(makeDeps({
      offline: true,
      createClient: () => ({ fetch: async () => { called = true; return []; } }),
    }));

    expect(called).toBe(false);
    expect(result.checks.find(c => c.id === 'token-valid')!.status).toBe('ok');
  });

  it('never includes the resolved token value in any check field', async () => {
    const SECRET = 'super-secret-token-xyz';
    const result = await runChecks(makeDeps({
      resolveToken: () => ({ token: SECRET, source: 'OURA_TOKEN' }),
    }));

    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('does not recommend sync as the next step when the reason there is no local data is the same unreachable API', async () => {
    // token-valid warns with no fix (network unreachable). data also warns,
    // with fix 'oura-cli sync' — but sync needs the same unreachable API, so
    // recommending it here would send the user to a command guaranteed to
    // fail for the same reason doctor just diagnosed. nextStep must stop at
    // the first non-ok check (token-valid) rather than skip past it.
    const result = await runChecks(makeDeps({
      offline: false,
      createClient: () => ({ fetch: async () => { throw new Error('network unreachable'); } }),
    }));

    const tokenValid = result.checks.find(c => c.id === 'token-valid')!;
    expect(tokenValid.status).toBe('warn');
    expect(tokenValid.fix).toBeUndefined();
    expect(result.nextStep).toBeNull();
    expect(result.ok).toBe(false);
  });

  it('reports data freshness from daily_activity alone, not just daily_sleep', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query(
      'INSERT OR REPLACE INTO daily_activity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run('a1', '2026-08-30', 77, 500, 11000, 8000, 600, 1200, 3600, 40000, 2500, 2400, '{}', '2026-08-30T00:00:00Z');

    const result = await runChecks(makeDeps({ openDb: () => ({ db, path: ':memory:' }) }));

    const dataCheck = result.checks.find(c => c.id === 'data')!;
    expect(dataCheck.status).toBe('ok');
    expect(dataCheck.detail).toContain('2026-08-30');
  });

  it('reports data freshness from daily_readiness alone, not just daily_sleep or daily_activity', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);
    db.query(
      'INSERT OR REPLACE INTO daily_readiness VALUES (?,?,?,?,?,?,?)',
    ).run('r1', '2026-08-30', 74, '{}', 0.1, 0, '2026-08-30T00:00:00Z');

    const result = await runChecks(makeDeps({ openDb: () => ({ db, path: ':memory:' }) }));

    const dataCheck = result.checks.find(c => c.id === 'data')!;
    expect(dataCheck.status).toBe('ok');
    expect(dataCheck.detail).toContain('2026-08-30');
  });
});

describe('exitCodeForChecks', () => {
  function checks(overrides: Partial<Record<DoctorCheck['id'], DoctorCheck['status']>>): DoctorCheck[] {
    const base: DoctorCheck[] = [
      { id: 'token', status: 'ok', detail: '' },
      { id: 'token-valid', status: 'ok', detail: '' },
      { id: 'database', status: 'ok', detail: '' },
      { id: 'data', status: 'ok', detail: '' },
    ];
    return base.map(c => (overrides[c.id] ? { ...c, status: overrides[c.id]! } : c));
  }

  it('exits 0 when nothing fails, even with warnings', () => {
    expect(exitCodeForChecks(checks({ data: 'warn' }))).toBe(0);
  });

  it('exits 2 when the token check fails', () => {
    expect(exitCodeForChecks(checks({ token: 'fail' }))).toBe(2);
  });

  it('exits 2 when the token-valid check fails', () => {
    expect(exitCodeForChecks(checks({ 'token-valid': 'fail' }))).toBe(2);
  });

  it('exits 4 when the database check fails', () => {
    expect(exitCodeForChecks(checks({ database: 'fail' }))).toBe(4);
  });
});

describe('formatDoctorTable', () => {
  it('does not claim everything is healthy when checks failed and no fix is available', () => {
    const result = {
      ok: false,
      checks: [
        { id: 'token' as const, status: 'ok' as const, detail: 'Token found via OURA_TOKEN.' },
        { id: 'token-valid' as const, status: 'ok' as const, detail: 'Skipped (--offline).' },
        { id: 'database' as const, status: 'fail' as const, detail: 'EROFS: read-only file system' },
        { id: 'data' as const, status: 'fail' as const, detail: 'Cannot check data — database unavailable.' },
      ],
      nextStep: null,
    };

    const out = formatDoctorTable(result);
    expect(out).not.toContain('everything looks healthy');
    expect(out).toContain('Next: see the failing checks above.');
  });

  it('still prints "everything looks healthy" when ok and nextStep is null', () => {
    const result = {
      ok: true,
      checks: [{ id: 'token' as const, status: 'ok' as const, detail: 'Token found via OURA_TOKEN.' }],
      nextStep: null,
    };

    expect(formatDoctorTable(result)).toContain('everything looks healthy');
  });
});

describe('resolveTokenLikeClient', () => {
  it('prefers an explicit token over OURA_TOKEN and the token file', () => {
    const prevToken = process.env.OURA_TOKEN;
    process.env.OURA_TOKEN = 'env-token-should-be-ignored';
    try {
      const result = resolveTokenLikeClient('explicit-token-abc');
      expect(result.token).toBe('explicit-token-abc');
      expect(result.source).toBe('--token');
    } finally {
      if (prevToken === undefined) delete process.env.OURA_TOKEN; else process.env.OURA_TOKEN = prevToken;
    }
  });
});
