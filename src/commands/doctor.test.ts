import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSchema } from '../db/database.js';
import { CliError } from '../lib/errors.js';
import { runChecks, type DoctorDeps } from './doctor.js';

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

  it('warns when the database has no data yet and points at sync', async () => {
    const result = await runChecks(makeDeps());

    const dataCheck = result.checks.find(c => c.id === 'data')!;
    expect(dataCheck.status).toBe('warn');
    expect(dataCheck.fix).toBe('oura-cli sync');
    expect(result.nextStep).toBe('oura-cli sync');
    expect(result.ok).toBe(true);
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
});
