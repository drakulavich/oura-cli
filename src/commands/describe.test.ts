import { describe, it, expect } from 'bun:test';
import { buildManifest } from './describe.js';

describe('buildManifest', () => {
  const m = buildManifest('0.1.0');

  it('reports name and version', () => {
    expect(m.name).toBe('oura-cli');
    expect(m.version).toBe('0.1.0');
  });

  it('includes auth section with env vars and login command', () => {
    expect(m.auth.envVars).toContain('OURA_TOKEN');
    expect(m.auth.envVars).toContain('OURA_TOKEN_PATH');
    expect(m.auth.loginCommand).toBe('oura-cli login');
  });

  it('declares the documented exit codes', () => {
    expect(m.exitCodes.find(e => e.code === 0)?.meaning).toMatch(/success/i);
    expect(m.exitCodes.find(e => e.code === 2)?.meaning).toMatch(/auth/i);
  });

  it('lists every supported subcommand', () => {
    const names = m.commands.map(c => c.name);
    for (const expected of ['login', 'describe', 'sleep', 'readiness', 'activity', 'hr', 'spo2', 'stress', 'workout', 'sync', 'db', 'report']) {
      expect(names).toContain(expected);
    }
  });

  it('uses stable output schema refs for data commands', () => {
    const sleep = m.commands.find(c => c.name === 'sleep')!;
    expect(sleep.outputSchema).toBe('docs/schemas/sleep.json');
  });

  it('lists subcommands for grouped data commands', () => {
    const m = buildManifest('0.1.2');
    const sleep = m.commands.find(c => c.name === 'sleep')!;
    expect(sleep.subcommands).toBeDefined();
    expect(sleep.subcommands!.map(s => s.name)).toEqual(['today', 'date', 'week']);

    const dateSub = sleep.subcommands!.find(s => s.name === 'date')!;
    expect(dateSub.args).toHaveLength(1);
    expect(dateSub.args[0].name).toBe('<day>');
  });

  it('lists db subcommands including stats, trends, reset', () => {
    const m = buildManifest('0.1.2');
    const db = m.commands.find(c => c.name === 'db')!;
    expect(db.subcommands!.map(s => s.name)).toContain('today');
    expect(db.subcommands!.map(s => s.name)).toContain('stats');
    expect(db.subcommands!.map(s => s.name)).toContain('trends');
    expect(db.subcommands!.map(s => s.name)).toContain('reset');
  });
});
