import { describe, it, expect } from 'bun:test';

describe('healthcheck and manifest commands', () => {
  describe('healthcheck', () => {
    it('emits ok=true with a version and latency when the DB initialises successfully', async () => {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', ':memory:', 'healthcheck'], { stdout: 'pipe' });
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.version).toBe('0.3.4');
      expect(typeof parsed.latencyMs).toBe('number');
    });
  });

  describe('manifest', () => {
    it('emits the openclaw tool-registry shape so the registry can discover and invoke commands', async () => {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', 'manifest'], { stdout: 'pipe' });
      const out = await new Response(proc.stdout).text();
      await proc.exited;

      const m = JSON.parse(out);
      expect(m.id).toBe('oura-cli');
      expect(m.version).toBe('0.3.4');
      expect(m.runtime).toBe('bun');
      expect(m.bin).toBe('oura-cli');
      expect(Array.isArray(m.commands)).toBe(true);
      expect(m.commands.length).toBeGreaterThanOrEqual(12);
      expect(m.envVars).toContain('OURA_TOKEN');
    });
  });
});
