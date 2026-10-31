import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { buildRegistry } from './commands/registry.js';

const ROOT = join(import.meta.dir, '..');

describe('README and command text match what ships (#152)', () => {
  it('links relatively only to files the package ships, since the installed README resolves them on disk', async () => {
    const readme = await Bun.file(join(ROOT, 'README.md')).text();
    const pack = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT });
    expect(pack.exitCode).toBe(0);
    const shipped = (JSON.parse(pack.stdout.toString()) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    const relative = [...readme.matchAll(/\]\(([^)#][^)]*)\)/g)].map((m) => m[1]!).filter((t) => !/^[a-z]+:/.test(t));
    expect(relative.filter((t) => !shipped.some((f) => (t.endsWith('/') ? f.startsWith(t) : f === t)))).toEqual([]);
  });

  it('ends every top-level command description with a period, as the root banner does', () => {
    const meta = Object.entries(buildRegistry('0.0.0')).map(([name, def]) => [name, (def as { meta: { description: string } }).meta.description]);
    expect(meta.filter(([, d]) => !d!.endsWith('.'))).toEqual([]);
  });
});
