import { describe, it, expect } from 'bun:test';
import { buildOpenclawManifest } from './manifest.js';
import { buildRegistry } from './registry.js';

describe('the OpenClaw manifest (#122)', () => {
  const m = buildOpenclawManifest('0.0.0', buildRegistry('0.0.0'));
  const db = m.commands.find(c => c.name === 'db')!;

  it('lists db subcommands with their descriptions, rows included, so they can be discovered without describe', () => {
    expect(db.subcommands?.map(s => s.name)).toEqual(['today', 'date', 'week', 'trends', 'stats', 'rows']);
    expect(db.subcommands?.find(s => s.name === 'rows')?.description).toContain('twin of `fetch`');
    expect(db.subcommands?.every(s => s.description.length > 0)).toBe(true);
  });

  it('gives db a rows example and leaves commands without subcommands as they were', () => {
    expect(db.examples).toContain('oura-cli db rows tags --days 30');
    for (const other of m.commands.filter(cmd => cmd.name !== 'db')) expect(other).not.toHaveProperty('subcommands');
  });
});
