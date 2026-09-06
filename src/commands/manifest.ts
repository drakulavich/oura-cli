import { defineCommand } from 'citty';
import type { ArgsDef } from 'citty';
import { commonArgs } from './common.js';
import { assertKnownArgs } from './run-command.js';
import type { SubCommandsDef } from 'citty';
import { buildManifest } from './describe.js';

export interface OpenclawManifest {
  id: string;
  version: string;
  runtime: 'bun';
  bin: string;
  description: string;
  commands: { name: string; description: string; examples: string[] }[];
  envVars: string[];
  healthcheck: { command: string; expects: Record<string, string> };
}

const EXAMPLES: Record<string, string[]> = {
  fetch:  ['oura-cli fetch sleep', 'oura-cli fetch hr --days 7', 'oura-cli fetch workout --from 2026-05-01 --to 2026-05-31'],
  db:     ['oura-cli db today', 'oura-cli db week --format json'],
  report: ['oura-cli report --period week'],
  doctor: ['oura-cli doctor --offline'],
};

export function buildOpenclawManifest(version: string, commands: SubCommandsDef): OpenclawManifest {
  const m = buildManifest(version, commands);
  return {
    id: 'oura-cli',
    version,
    runtime: 'bun',
    bin: 'oura-cli',
    description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
    commands: m.commands.map(c => ({
      name: c.name,
      description: c.description,
      examples: EXAMPLES[c.name] ?? [`oura-cli ${c.name}`],
    })),
    envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH', 'OURA_DB_PATH', 'OURA_TZ'],
    healthcheck: { command: 'healthcheck', expects: { ok: 'boolean', version: 'string', latencyMs: 'number', error: 'string, present only when ok is false' } },
  };
}

export function manifestCommand(version: string, getCommands: () => SubCommandsDef) {
  return defineCommand({
    meta: { name: 'manifest', description: 'Print openclaw-tool-registry-compatible manifest as JSON.' },
    args: { ...commonArgs },
    run({ args }) {
      assertKnownArgs(commonArgs as ArgsDef, args as Record<string, unknown>);
      console.log(JSON.stringify(buildOpenclawManifest(version, getCommands()), null, 2));
    },
  });
}
