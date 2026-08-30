import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;

describe('healthcheck and manifest commands', () => {
  describe('healthcheck', () => {
    it('emits ok=true with a version and latency when the DB initialises successfully', async () => {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', ':memory:', 'healthcheck'], { stdout: 'pipe' });
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.version).toBe(PACKAGE_VERSION);
      expect(typeof parsed.latencyMs).toBe('number');
    });
  });

  describe('doctor', () => {
    it('emits --offline --format json output that validates against docs/schemas/doctor.json', async () => {
      const proc = Bun.spawn(
        ['bun', 'run', 'src/index.ts', '--db', ':memory:', 'doctor', '--offline', '--format', 'json'],
        { stdout: 'pipe' },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      const parsed = JSON.parse(out);
      const schema = JSON.parse(readFileSync(join(import.meta.dir, '..', 'docs', 'schemas', 'doctor.json'), 'utf-8'));
      const ajv = new Ajv({ strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      const ok = validate(parsed);
      if (!ok) console.error(validate.errors);
      expect(ok).toBe(true);
    });

    it('honors --token even when OURA_TOKEN and the token file are both unavailable', async () => {
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      delete env.OURA_TOKEN;
      env.OURA_TOKEN_PATH = '/nonexistent/for-doctor-token-e2e-test';
      const proc = Bun.spawn(
        ['bun', 'run', 'src/index.ts', '--db', ':memory:', 'doctor', '--offline', '--token', 'e2e-test-token-abc', '--format', 'json'],
        { stdout: 'pipe', env },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      const parsed = JSON.parse(out);
      const tokenCheck = parsed.checks.find((c: { id: string }) => c.id === 'token');
      expect(tokenCheck.status).toBe('ok');
      expect(tokenCheck.detail).toContain('--token');
      expect(proc.exitCode).toBe(0);
    });

    it('exits non-zero when the token cannot be resolved at all', async () => {
      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      delete env.OURA_TOKEN;
      env.OURA_TOKEN_PATH = '/nonexistent/for-doctor-exit-e2e-test';
      const proc = Bun.spawn(
        ['bun', 'run', 'src/index.ts', '--db', ':memory:', 'doctor', '--offline', '--format', 'json'],
        { stdout: 'pipe', env },
      );
      await new Response(proc.stdout).text();
      await proc.exited;

      expect(proc.exitCode).toBe(2);
    });

    it('exits 0 when only a warning is present, not a failure', async () => {
      const proc = Bun.spawn(
        ['bun', 'run', 'src/index.ts', '--db', ':memory:', 'doctor', '--offline', '--token', 'e2e-ok-token', '--format', 'json'],
        { stdout: 'pipe' },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      // Empty :memory: db means the data check warns, but nothing fails.
      const parsed = JSON.parse(out);
      expect(parsed.checks.find((c: { id: string }) => c.id === 'data').status).toBe('warn');
      expect(proc.exitCode).toBe(0);
    });

    it('prints the doctor table with per-check lines and a Next: line in table mode', async () => {
      const proc = Bun.spawn(
        ['bun', 'run', 'src/index.ts', '--db', ':memory:', 'doctor', '--offline', '--token', 'e2e-table-token', '--no-color', '--format', 'table'],
        { stdout: 'pipe' },
      );
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      expect(out).toContain('Doctor');
      expect(out).toContain('token');
      expect(out).toContain('database');
      expect(out).toContain('Next:');
    });
  });

  describe('manifest', () => {
    it('emits the openclaw tool-registry shape so the registry can discover and invoke commands', async () => {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', 'manifest'], { stdout: 'pipe' });
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      const m = JSON.parse(out);
      expect(m.id).toBe('oura-cli');
      expect(m.version).toBe(PACKAGE_VERSION);
      expect(m.runtime).toBe('bun');
      expect(m.bin).toBe('oura-cli');
      expect(Array.isArray(m.commands)).toBe(true);
      expect(m.commands.length).toBeGreaterThanOrEqual(13);
      expect(m.envVars).toContain('OURA_TOKEN');
    });
  });
});
