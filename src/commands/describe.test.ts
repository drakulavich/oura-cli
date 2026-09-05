import { describe, it, expect } from 'bun:test';
import { buildManifest } from './describe.js';

describe('buildManifest', () => {
  describe('top-level identity', () => {
    it('reports the package name and the version passed in', () => {
      const m = buildManifest('0.1.0');

      expect(m.name).toBe('oura-cli');
      expect(m.version).toBe('0.1.0');
    });

    it('exposes the openclaw compat manifest command so agents can discover it', () => {
      const m = buildManifest('0.1.0');

      expect(m.compatManifestCommand).toBe('oura-cli manifest');
    });
  });

  describe('auth section', () => {
    it('lists the environment variables agents need to supply a token', () => {
      const m = buildManifest('0.1.0');

      expect(m.auth.envVars).toEqual(expect.arrayContaining(['OURA_TOKEN', 'OURA_TOKEN_PATH']));
      expect(m.auth.loginCommand).toBe('oura-cli login');
    });
  });

  describe('exit codes', () => {
    it('documents exit code 0 as success and exit code 2 as auth failure', () => {
      const m = buildManifest('0.1.0');

      expect(m.exitCodes.find(e => e.code === 0)?.meaning).toMatch(/success/i);
      expect(m.exitCodes.find(e => e.code === 2)?.meaning).toMatch(/auth/i);
    });
  });

  describe('commands list', () => {
    it('includes every supported subcommand', () => {
      const m = buildManifest('0.1.0');
      const expected = ['login', 'describe', 'doctor', 'sleep', 'readiness', 'activity', 'hr', 'spo2', 'stress', 'workout', 'sync', 'db', 'report'].sort();

      expect(m.commands.map(c => c.name).sort()).toEqual(expected);
    });

    it('uses stable output schema refs for data commands so agents can validate responses', () => {
      const m = buildManifest('0.1.0');
      const sleep = m.commands.find(c => c.name === 'sleep')!;

      expect(sleep.outputSchema).toBe('docs/schemas/sleep.json');
    });

    it('lists today, date, and week subcommands for data commands', () => {
      const m = buildManifest('0.1.2');
      const sleep = m.commands.find(c => c.name === 'sleep')!;

      expect(sleep.subcommands).toBeDefined();
      expect(sleep.subcommands!.map(s => s.name)).toEqual(['today', 'date', 'week']);
    });

    it('describes the date subcommand argument so agents know what to pass', () => {
      const m = buildManifest('0.1.2');
      const dateSub = m.commands.find(c => c.name === 'sleep')!.subcommands!.find(s => s.name === 'date')!;

      expect(dateSub.args).toHaveLength(1);
      expect(dateSub.args[0].name).toBe('<day>');
    });

    it('includes today, stats, and trends as db subcommands', () => {
      const m = buildManifest('0.1.2');
      const db = m.commands.find(c => c.name === 'db')!;
      const names = db.subcommands!.map(s => s.name);

      expect(names).toEqual(expect.arrayContaining(['today', 'stats', 'trends']));
      expect(names).not.toEqual(expect.arrayContaining(['import', 'reset']));
    });

    it('report command has a --period flag accepting week and month, with no nested subcommands', () => {
      const m = buildManifest('0.3.0');
      const report = m.commands.find(c => c.name === 'report')!;

      expect(report.subcommands).toBeUndefined();
      const periodArg = report.args.find(a => a.name === '--period');
      expect(periodArg).toBeDefined();
      expect(periodArg!.values).toEqual(['week', 'month']);
    });
  });
});
