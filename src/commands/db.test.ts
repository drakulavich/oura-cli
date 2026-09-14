import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureSchema } from '../db/open.js';
import { emptyDayHint } from './db.js';

async function run(...argv: string[]) {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', ':memory:', ...argv], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

describe('emptyDayHint (#133)', () => {
  const TODAY = '2026-06-15';
  function cache(withDays: boolean): Database {
    const db = new Database(':memory:');
    ensureSchema(db);
    if (withDays) db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('s1', '2026-06-01', 80, '{}', '');
    return db;
  }

  it('tells an empty cache to download, whatever the day', () => {
    const db = cache(false);
    for (const day of ['2026-06-01', TODAY, '2026-07-01']) expect(emptyDayHint(db, day, TODAY)).toContain('to download your data');
    db.close();
  });

  it('gives today the publish-delay note and a future day no fetch at all', () => {
    const db = cache(true);
    expect(emptyDayHint(db, TODAY, TODAY)).toContain("Oura publishes a day's summary");
    expect(emptyDayHint(db, '2026-06-16', TODAY)).toBe('2026-06-16 is after today (2026-06-15); nothing can be cached for it yet.');
    db.close();
  });

  it('places a past day against the cached summaries: before the first, after the last, or a gap a sync has passed (#143)', () => {
    const db = cache(true); // holds 2026-06-01
    db.query('INSERT INTO daily_readiness (id, day) VALUES (?,?)').run('r1', '2026-06-10'); // the range spans the three daily tables
    db.query("INSERT INTO daily_stress (id, day) VALUES ('st', '2026-06-05')").run(); // not a summary: must not make the day "cached"
    expect(emptyDayHint(db, '2026-05-20', TODAY)).toBe('No daily summaries for 2026-05-20: the cache begins at 2026-06-01. Run `oura-cli sync --from 2026-05-20` to fetch it if Oura has it.');
    expect(emptyDayHint(db, '2026-06-12', TODAY)).toBe('No daily summaries for 2026-06-12: the cache ends at 2026-06-10. Run `oura-cli sync`; if it adds nothing, the ring has not uploaded (`oura-cli doctor` says which side is behind).');
    // The loop of the issue: a day inside the cache that a sync has already asked for. No sync --from as the first move.
    const gap = emptyDayHint(db, '2026-06-05', TODAY);
    // "Most likely", not a fact: two explicit --from/--to windows leave a gap no sync covered.
    expect(gap).toBe('No daily summaries for 2026-06-05, though the cache runs from 2026-06-01 to 2026-06-10: most likely Oura has none for that day. `oura-cli sync --from 2026-06-05` re-fetches it in case a sync skipped it.');
    expect(gap).not.toContain('Nothing cached');
    // The boundary days themselves are inside the cache: a summary row whose scores are all NULL is
    // an empty panel on the first or last cached day, and neither "begins at" nor "ends at" applies.
    // The hint names the range rather than "days on both sides", which a boundary day does not have.
    db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('s0', '2026-05-30', null, '{}', '');
    expect(emptyDayHint(db, '2026-05-30', TODAY)).toStartWith('No daily summaries for 2026-05-30, though the cache runs from 2026-05-30 to 2026-06-10');
    expect(emptyDayHint(db, '2026-06-10', TODAY)).toStartWith('No daily summaries for 2026-06-10, though the cache runs from 2026-05-30 to 2026-06-10');
    db.close();
  });
});

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

  it('db date: explains an empty past day the way db today does, instead of printing dashes (#133)', async () => {
    const empty = await run('db', 'date', '2026-06-02', '--format', 'table');
    expect(empty.stdout).toContain('No Oura data for 2026-06-02 yet.');
    expect(empty.stdout).toContain('to download your data');

    const path = join(tmpdir(), `oura-db-date-hint-${process.pid}.db`);
    const db = new Database(path);
    ensureSchema(db);
    db.query('INSERT INTO daily_sleep VALUES (?,?,?,?,?)').run('s1', '2026-06-01', 80, '{}', '');
    db.close();
    try {
      const proc = Bun.spawn(['bun', 'run', 'src/index.ts', '--db', path, 'db', 'date', '2026-06-02', '--format', 'table'], { stdout: 'pipe', stderr: 'pipe' });
      const text = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(text).toContain('No daily summaries for 2026-06-02: the cache ends at 2026-06-01. Run `oura-cli sync`;');
      expect(text).not.toMatch(/Sleep: +—/);
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
