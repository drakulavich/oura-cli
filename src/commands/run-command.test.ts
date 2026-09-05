import { describe, it, expect } from 'bun:test';
import { execute, type RunnerIo, type DataCommandDef, type Ctx } from './run-command.js';
import { CliError } from '../lib/errors.js';
import { OuraClient } from '../api/client.js';

function fakeIo(isTty = false) {
  const out: string[] = []; const err: string[] = []; const exits: number[] = [];
  const io: RunnerIo = {
    stdout: s => out.push(s), stderr: s => err.push(s), exit: c => exits.push(c), isTty,
  };
  return { io, out, err, exits };
}

const baseArgs = { _: [] as string[], format: undefined, token: undefined, db: ':memory:', tz: 'UTC', 'no-color': true } as any;

describe('execute', () => {
  it('prints JSON when stdout is not a TTY', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: { a: 1 }, text: () => 'table' }) };
    const { io, out } = fakeIo(false);
    await execute(def, baseArgs, io);
    expect(JSON.parse(out[0])).toEqual({ a: 1 });
  });

  it('prints text when stdout is a TTY', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: {}, text: () => 'table' }) };
    const { io, out } = fakeIo(true);
    await execute(def, baseArgs, io);
    expect(out[0]).toBe('table');
  });

  it('forces JSON for jsonOnly commands even on a TTY with --format table', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, jsonOnly: true, run: () => ({ json: [1], text: () => 'no' }) };
    const { io, out } = fakeIo(true);
    await execute(def, { ...baseArgs, format: 'table' }, io);
    expect(out[0]).toBe(JSON.stringify([1], null, 2));
  });

  it('rejects an unknown --format for jsonOnly commands too', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, jsonOnly: true, run: () => ({ json: 1, text: () => '1' }) };
    const { io, out, err, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, format: 'yaml' }, io);
    expect(out).toEqual([]);
    expect(JSON.parse(err[0]).error.code).toBe('BAD_ARGS');
    expect(exits).toEqual([1]);
  });

  it('renders errors from jsonOnly commands as text on a TTY', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, jsonOnly: true, run: () => { throw new CliError('BAD_ARGS', 'nope'); } };
    const { io, err } = fakeIo(true);
    await execute(def, baseArgs, io);
    expect(err[0]).toContain('error: nope');
    expect(() => JSON.parse(err[0])).toThrow();
  });

  it('opens a schema-ready database when needs.db is set and closes it afterwards', async () => {
    let captured: Ctx['db'];
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: ctx => {
        captured = ctx.db;
        const row = ctx.db!.query('SELECT COUNT(*) AS n FROM daily_sleep').get() as { n: number };
        return { json: row, text: () => '' };
      },
    };
    const { io, out } = fakeIo();
    await execute(def, baseArgs, io);
    expect(JSON.parse(out[0])).toEqual({ n: 0 });
    expect(() => captured!.query('SELECT 1').get()).toThrow(); // closed handles reject new statements
  });

  it('closes the database and emits a formatted error with the mapped exit code when run throws', async () => {
    let captured: Ctx['db'];
    const dbClosedAtExit: boolean[] = [];
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: ctx => { captured = ctx.db; throw new CliError('DB_ERROR', 'boom'); },
    };
    const err: string[] = []; const exits: number[] = [];
    const io: RunnerIo = {
      stdout: () => {}, stderr: s => err.push(s), isTty: false,
      exit: c => {
        dbClosedAtExit.push((() => {
          try { captured!.query('SELECT 1').get(); return false; } catch { return true; }
        })());
        exits.push(c);
      },
    };
    await execute(def, baseArgs, io);
    expect(JSON.parse(err[0])).toEqual({ error: { code: 'DB_ERROR', message: 'boom' } });
    expect(exits).toEqual([4]);
    expect(dbClosedAtExit).toEqual([true]);
  });

  it('closes the database before exiting when run returns a non-zero exitCode', async () => {
    let captured: Ctx['db'];
    const dbClosedAtExit: boolean[] = [];
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: ctx => { captured = ctx.db; return { json: 1, text: () => '1', exitCode: 2 }; },
    };
    const out: string[] = []; const exits: number[] = [];
    const io: RunnerIo = {
      stdout: s => out.push(s), stderr: () => {}, isTty: false,
      exit: c => {
        dbClosedAtExit.push((() => {
          try { captured!.query('SELECT 1').get(); return false; } catch { return true; }
        })());
        exits.push(c);
      },
    };
    await execute(def, baseArgs, io);
    expect(exits).toEqual([2]);
    expect(dbClosedAtExit).toEqual([true]);
  });

  it('resolves ctx.today in the requested timezone', async () => {
    const { setSystemTime } = await import('bun:test');
    setSystemTime(new Date('2026-06-15T20:00:00Z'));
    try {
      const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: ctx => ({ json: ctx.today, text: () => ctx.today }) };
      const { io, out } = fakeIo(false);
      await execute(def, { ...baseArgs, tz: 'Pacific/Kiritimati' }, io);
      expect(JSON.parse(out[0])).toBe('2026-06-16');
    } finally { setSystemTime(); }
  });

  it('exits with the Output exitCode when it is non-zero', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: 1, text: () => '1', exitCode: 2 }) };
    const { io, exits } = fakeIo(false);
    await execute(def, baseArgs, io);
    expect(exits).toEqual([2]);
  });

  it('maps a SQLite error thrown inside run to DB_ERROR / exit 4', async () => {
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: ctx => ({ json: ctx.db!.query('SELECT * FROM no_such_table').all(), text: () => '' }),
    };
    const { io, err, exits } = fakeIo(false);
    await execute(def, baseArgs, io);
    const env = JSON.parse(err[0]).error;
    expect(env.code).toBe('DB_ERROR');
    expect(env.message).toContain('no_such_table');
    expect(exits).toEqual([4]);
  });

  it('reports a corrupt database file as DB_ERROR / exit 4', async () => {
    const path = `/tmp/oura-runner-corrupt-${process.pid}.db`;
    await Bun.write(path, 'junk');
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, needs: { db: true }, run: () => ({ json: 1, text: () => '1' }) };
    const { io, err, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, db: path }, io);
    expect(JSON.parse(err[0]).error.code).toBe('DB_ERROR');
    expect(exits).toEqual([4]);
  });

  it('rejects an unknown --tz with BAD_ARGS before running the command', async () => {
    let ran = false;
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => { ran = true; return { json: 1, text: () => '1' }; } };
    const { io, err, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, tz: 'Not/AZone' }, io);
    expect(ran).toBe(false);
    expect(JSON.parse(err[0]).error.code).toBe('BAD_ARGS');
    expect(exits).toEqual([1]);
  });

  it('rejects an unknown --format with BAD_ARGS', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: 1, text: () => '1' }) };
    const { io, err, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, format: 'yaml' }, io);
    expect(JSON.parse(err[0]).error.code).toBe('BAD_ARGS');
    expect(exits).toEqual([1]);
  });

  it('maps a missing token to TOKEN_MISSING / exit 2 when needs.client is set', async () => {
    const saved = { OURA_TOKEN: process.env.OURA_TOKEN, OURA_TOKEN_PATH: process.env.OURA_TOKEN_PATH };
    delete process.env.OURA_TOKEN;
    process.env.OURA_TOKEN_PATH = '/nonexistent/oura-token-for-runner-test';
    try {
      const def: DataCommandDef<{}> = {
        meta: { name: 'x' }, needs: { client: true },
        run: () => ({ json: 'unreachable', text: () => 'unreachable' }),
      };
      const { io, out, err, exits } = fakeIo(false);
      await execute(def, { ...baseArgs, token: undefined }, io);
      expect(out).toEqual([]);
      expect(JSON.parse(err[0]).error.code).toBe('TOKEN_MISSING');
      expect(exits).toEqual([2]);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('builds ctx.client from args.token when needs.client is set', async () => {
    let captured: Ctx['client'];
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { client: true },
      run: ctx => { captured = ctx.client; return { json: true, text: () => '' }; },
    };
    const { io, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, token: 'inline-token' }, io);
    expect(captured).toBeInstanceOf(OuraClient);
    expect(exits).toEqual([]);
  });
});
