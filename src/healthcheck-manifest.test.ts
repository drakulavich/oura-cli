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
