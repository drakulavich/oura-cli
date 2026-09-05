import { describe, it, expect } from 'bun:test';
import { execute, type RunnerIo, type DataCommandDef, type Ctx } from './run-command.js';
import { CliError } from '../lib/errors.js';

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
    const def: DataCommandDef<{}> = {
      meta: { name: 'x' }, needs: { db: true },
      run: () => { throw new CliError('DB_ERROR', 'boom'); },
    };
    const { io, err, exits } = fakeIo(false);
    await execute(def, baseArgs, io);
    expect(JSON.parse(err[0])).toEqual({ error: { code: 'DB_ERROR', message: 'boom' } });
    expect(exits).toEqual([4]);
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

  it('rejects an unknown --format with BAD_ARGS', async () => {
    const def: DataCommandDef<{}> = { meta: { name: 'x' }, run: () => ({ json: 1, text: () => '1' }) };
    const { io, err, exits } = fakeIo(false);
    await execute(def, { ...baseArgs, format: 'yaml' }, io);
    expect(JSON.parse(err[0]).error.code).toBe('BAD_ARGS');
    expect(exits).toEqual([1]);
  });
});
