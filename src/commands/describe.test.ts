import { describe, it, expect } from 'bun:test';
import { defineCommand } from 'citty';
import { describeCommand, buildManifest } from './describe.js';
import { buildOpenclawManifest } from './manifest.js';
import { names } from '../collections/index.js';
import { fetchCommand } from './fetch.js';
import { dbCommand } from './db.js';
import { reportCommand } from './report.js';
import { doctorCommand } from './doctor.js';
import { commonArgs } from './common.js';

// `login` mirrors the real command: it declares its own `token`/`path` args
// (not `commonArgs`, since login's --token means something different from
// the global --token) but reuses the shared `no-color` definition by
// reference so describe's identity-based skip hides it like every other
// command's global flags.
const commands = { fetch: fetchCommand, db: dbCommand, report: reportCommand, doctor: doctorCommand,
  login: defineCommand({ meta: { name: 'login', description: 'Save a token.' }, args: {
    token: { type: 'string', description: 'Pass token' },
    path: { type: 'string', description: 'Where to save the token' },
    'no-color': commonArgs['no-color'],
  } }) };

describe('buildManifest', () => {
  const m = buildManifest('9.9.9', commands);

  it('reports name, version and the compat manifest command', () => {
    expect(m.name).toBe('oura-cli');
    expect(m.version).toBe('9.9.9');
    expect(m.compatManifestCommand).toBe('oura-cli manifest');
  });

  it('lists exactly the registered top-level commands', () => {
    expect(m.commands.map(c => c.name).sort()).toEqual(Object.keys(commands).sort());
  });

  it('does not list global flags as per-command args', () => {
    const report = m.commands.find(c => c.name === 'report')!;
    expect(report.args.map(a => a.name)).toEqual(['--period']);
  });

  it('lists login\'s own --token and --path but hides the shared --no-color global flag', () => {
    const login = m.commands.find(c => c.name === 'login')!;
    expect(login.args.map(a => a.name)).toEqual(['--token', '--path']);
  });

  it('describes db subcommands with their positionals', () => {
    const db = m.commands.find(c => c.name === 'db')!;
    expect(db.subcommands?.map(s => s.name)).toEqual(['today', 'date', 'week', 'trends', 'stats']);
    expect(db.subcommands?.find(s => s.name === 'date')?.args[0]).toMatchObject({ name: '<day>', required: true });
  });

  it('gives fetch a collection enum and one output schema per collection', () => {
    const fetch = m.commands.find(c => c.name === 'fetch')!;
    expect(fetch.args.find(a => a.name === '<collection>')?.values).toEqual(names());
    expect(fetch.outputSchemas).toEqual(Object.fromEntries(names().map(n => [n, `docs/schemas/${n}.json`])));
  });

  it('points doctor at its output schema', () => {
    expect(m.commands.find(c => c.name === 'doctor')?.outputSchema).toBe('docs/schemas/doctor.json');
  });

  it('matches the snapshot (any diff here is a contract change)', () => {
    expect(m).toMatchSnapshot();
  });
});

describe('buildOpenclawManifest', () => {
  const o = buildOpenclawManifest('9.9.9', commands);
  it('has one entry per command with a runnable example', () => {
    expect(o.commands.map(c => c.name).sort()).toEqual(Object.keys(commands).sort());
    for (const c of o.commands) expect(c.examples[0]).toMatch(/^oura-cli /);
  });
  it('never advertises flags the CLI does not have', () => {
    expect(JSON.stringify(o)).not.toContain('--start');
  });
  it('matches the snapshot', () => {
    expect(o).toMatchSnapshot();
  });
});

describe('schema discovery', () => {
  it('links the manifest schema from the describe entry itself, so an agent can validate what it just read', () => {
    const describe = describeCommand('0.0.0', () => ({}));
    const manifest = buildManifest('0.0.0', { describe });
    expect(manifest.commands.find(c => c.name === 'describe')?.outputSchema).toBe('docs/schemas/describe.json');
  });
});
