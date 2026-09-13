import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureSchema } from '../db/open.js';

async function run(...argv: string[]) {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', ':memory:', ...argv], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

describe('db date', () => {
  it('rejects a calendar-invalid date with BAD_ARGS before querying', async () => {
    const { stdout, stderr, code } = await run('db', 'date', '2026-02-30', '--format', 'json');
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error.code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('accepts a real date and returns the (empty) day summary', async () => {
    const { stdout, code } = await run('db', 'date', '2026-06-15', '--format', 'json');
    expect(code).toBe(0);
    expect(JSON.parse(stdout).day).toBe('2026-06-15');
  });
});

describe('db trends', () => {
  it.each(['abc', '0', '1.5'])('rejects a window of %j with BAD_ARGS', async days => {
    const { stdout, stderr, code } = await run('db', 'trends', days, '--format', 'json');
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error.code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('accepts a positive window', async () => {
    const { stdout, code } = await run('db', 'trends', '7', '--format', 'json');
    expect(code).toBe(0);
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  });
});

describe('db rows (#73)', () => {
  it('rejects an unknown collection with the valid list', async () => {
    const { stdout, stderr, code } = await run('db', 'rows', 'bogus', '--format', 'json');
    expect(stdout).toBe('');
    const e = JSON.parse(stderr).error;
    expect(e.code).toBe('BAD_ARGS');
    expect(e.message).toBe('Unknown collection "bogus".');
    expect(e.hint).toContain('tags');
    expect(code).toBe(1);
  });

  it('rejects range flags for the ring snapshot, like fetch does', async () => {
    const { stderr, code } = await run('db', 'rows', 'ring', '--day', '2026-06-15', '--format', 'json');
    expect(JSON.parse(stderr).error.message).toContain('snapshot');
    expect(code).toBe(1);
  });

  it('rejects a bad --days before touching the cache', async () => {
    const { stderr, code } = await run('db', 'rows', 'tags', '--days', '0', '--format', 'json');
    expect(JSON.parse(stderr).error.code).toBe('BAD_ARGS');
    expect(code).toBe(1);
  });

  it('rejects a bad --limit, and accepts a positive one', async () => {
    const bad = await run('db', 'rows', 'tags', '--limit', '0', '--format', 'json');
    expect(JSON.parse(bad.stderr).error.message).toContain('--limit');
    expect(bad.code).toBe(1);
    const ok = await run('db', 'rows', 'tags', '--limit', '5', '--format', 'json');
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual([]);
  });

  it('applies --limit to the rows it prints and says how many the range holds', async () => {
    const path = join(tmpdir(), `oura-db-rows-limit-${process.pid}.db`);
    const db = new Database(path);
    ensureSchema(db);
    const tag = db.query('INSERT INTO enhanced_tags (id, day, end_day, start_time, end_time, tag_type_code, comment, custom_name) VALUES (?,?,?,?,?,?,?,?)');
    for (const [id, day] of [['t1', '2026-06-13'], ['t2', '2026-06-14'], ['t3', '2026-06-15']]) tag.run(id, day, null, null, null, 'tag_generic_nap', null, null);
    db.close();
    try {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', path, 'db', 'rows', 'tags', '--from', '2026-06-01', '--to', '2026-06-30', '--limit', '2', '--format', 'json'], { stdout: 'pipe', stderr: 'pipe' });
      const json = JSON.parse(await new Response(proc.stdout).text()) as Array<{ id: string }>;
      expect(await proc.exited).toBe(0);
      expect(json.map(r => r.id)).toEqual(['t1', 't2']);

      const table = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', path, 'db', 'rows', 'tags', '--from', '2026-06-01', '--to', '2026-06-30', '--limit', '2', '--format', 'table'], { stdout: 'pipe', stderr: 'pipe' });
      const text = await new Response(table.stdout).text();
      expect(await table.exited).toBe(0);
      expect(text).toContain('tags (enhanced_tags): 2 of 3 rows for 2026-06-01 → 2026-06-30');
      expect(text).toContain('t2');
      expect(text).not.toContain('t3');
    } finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    }
  });

  it('db today: "download your data" only on an empty cache; a cache with days gets the publish-delay note (#127)', async () => {
    const empty = await run('db', 'today', '--format', 'table');
    expect(empty.stdout).toContain('to download your data');

    const path = join(tmpdir(), `oura-db-today-hint-${process.pid}.db`);
    const db = new Database(path);
    ensureSchema(db);
    db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('s1', '2026-06-01', 80, '{}', '');
    db.close();
    try {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', path, 'db', 'today', '--format', 'table'], { stdout: 'pipe', stderr: 'pipe' });
      const text = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(text).not.toContain('to download your data');
      expect(text).toContain("Oura publishes a day's summary after that night's sleep syncs from the ring. If the ring has synced since, run `oura-cli sync` again.");
    } finally {
      for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    }
  });

  it('gives the ring snapshot no --from hint, since it has no history to reach back into', async () => {
    const text = await run('db', 'rows', 'ring', '--format', 'table');
    expect(text.stdout).not.toContain('--from');
    const tags = await run('db', 'rows', 'tags', '--format', 'table');
    expect(tags.stdout).toContain('sync --from <day>');
  });

  it('returns an empty array for an empty cache in JSON, and an explanation in text', async () => {
    const json = await run('db', 'rows', 'tags', '--days', '7', '--format', 'json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual([]);

    const text = await run('db', 'rows', 'ring', '--format', 'table');
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('ring (ring_configuration): 0 rows');
    expect(text.stdout).toContain('No cached ring rows.');
    expect(text.stdout).toContain('oura-cli fetch ring');
  });
});
