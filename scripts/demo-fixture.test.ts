import { describe, it, expect, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { today } from '../src/lib/time.js';

const SCRIPT = join(import.meta.dir, 'demo-fixture.ts');
// A parent with a space in its name, so every path below exercises the quoting.
const parent = mkdtempSync(join(tmpdir(), 'oura fixture test-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', SCRIPT, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, code: await proc.exited };
}

/** Run `sql` against the fixture's cache in `dir` and return every row. */
function query<T>(dir: string, sql: string): T[] {
  const db = new Database(join(dir, '.oura-cli', 'oura.db'), { readonly: true });
  try {
    return db.query(sql).all() as T[];
  } finally {
    db.close();
  }
}
const newestDay = (dir: string) => query<{ d: string }>(dir, 'SELECT MAX(day) AS d FROM daily_sleep')[0]!.d;

describe('scripts/demo-fixture.ts', () => {
  it('refuses a directory that already exists and leaves its contents alone', async () => {
    const dir = join(parent, 'precious');
    mkdirSync(dir);
    writeFileSync(join(dir, 'keep.txt'), 'keep');
    const { code, stderr } = await run([dir]);
    expect(code).toBe(1);
    expect(stderr).toContain('already exists');
    expect(readFileSync(join(dir, 'keep.txt'), 'utf-8')).toBe('keep');
    expect(existsSync(join(dir, '.oura-cli'))).toBe(false);
  });

  it('never deletes: the script has no rmSync and no marker file that could license one', () => {
    const source = readFileSync(SCRIPT, 'utf-8');
    expect(source).not.toContain('rmSync');
    expect(source).not.toContain('MARKER');
  });

  it('builds a fake home with a placeholder token, a quoted shim and a cache that ends today in the CLI timezone', async () => {
    const dir = join(parent, 'home one');
    const tz = 'Pacific/Kiritimati'; // UTC+14: "today" here is often tomorrow in UTC, which is what the fixture must follow
    const { code, stdout } = await run([dir], { OURA_TZ: tz });
    expect(code).toBe(0);

    const token = readFileSync(join(dir, '.oura-token'), 'utf-8');
    expect(token).toContain('not-a-real-credential');
    expect(statSync(join(dir, '.oura-token')).mode & 0o777).toBe(0o600);

    const shim = readFileSync(join(dir, 'bin', 'oura-cli'), 'utf-8');
    expect(shim).toMatch(/^#!\/bin\/sh\nexec bun '[^\n]*src\/index\.ts' "\$@"\n$/);
    expect(statSync(join(dir, 'bin', 'oura-cli')).mode & 0o111).toBe(0o111);

    const newest = newestDay(dir);
    expect(newest).toBe(today(tz));
    expect(query<{ n: number }>(dir, 'SELECT COUNT(*) AS n FROM daily_sleep')[0]!.n).toBe(60);
    // Today is still accumulating, so the demo shows the `*`.
    expect(query<{ slots: number }>(dir, `SELECT class_5_min_slots AS slots FROM daily_activity WHERE day = '${newest}'`)[0]!.slots).toBeLessThan(288);
    for (const { id } of query<{ id: string }>(dir, 'SELECT id FROM daily_spo2 LIMIT 3')) expect(id).toEndWith('-demo');

    // The printed command must survive copy-paste even though the path has a space.
    const line = stdout.split('\n').find(l => l.startsWith('record with:'))!;
    expect(line).toContain(`HOME='${dir}'`);
    expect(line).toContain(`PATH='${join(dir, 'bin')}':"$PATH"`);
  });

  // UTC+14 and UTC-11 are 25 hours apart, so at any moment at least one of them is on a different
  // calendar day from UTC: a fixture that took "today" from UTC would fail one of these whatever the hour.
  it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('ends on today in %s, not UTC', async tz => {
    const dir = join(parent, `tz ${tz.replace('/', '-')}`);
    expect((await run([dir], { OURA_TZ: tz })).code).toBe(0);
    expect(newestDay(dir)).toBe(today(tz));
  });

  it('with no argument builds into a fresh temp directory and prints where', async () => {
    const { code, stdout } = await run([], { TMPDIR: parent });
    expect(code).toBe(0);
    const made = stdout.match(/demo home ready at (.+?) \(/)?.[1];
    expect(made).toBeDefined();
    expect(made!.startsWith(join(parent, 'oura-demo-'))).toBe(true);
    expect(existsSync(join(made!, '.oura-cli', 'oura.db'))).toBe(true);
  });

  it('is deterministic: two builds on the same day hold the same numbers', async () => {
    const a = join(parent, 'a');
    const b = join(parent, 'b');
    expect((await run([a])).code).toBe(0);
    expect((await run([b])).code).toBe(0);
    const scores = (dir: string) => query(dir, 'SELECT day, score FROM daily_sleep ORDER BY day');
    expect(scores(a)).toEqual(scores(b));
  });
});
