import { describe, it, expect } from 'bun:test';
import { basename, dirname, join } from 'node:path';
import { buildManifest, type ManifestArg, type ManifestCommand } from '../src/commands/describe.js';
import { buildRegistry } from '../src/commands/registry.js';
import { names } from '../src/collections/index.js';
import { ERROR_CODES } from '../src/lib/errors.js';
import { RECOMMENDATIONS } from '../src/render/format-report.js';

// The skill is prose an agent reads instead of `describe`, so it must not name a command,
// subcommand, flag, collection or error code the CLI does not have. This test tokenises every
// `oura-cli …` invocation in the file and resolves each token against the manifest.
const skillPath = join(import.meta.dir, 'oura-cli', 'SKILL.md');
const text = await Bun.file(skillPath).text();
const [, frontmatterText, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
const frontmatter = Bun.YAML.parse(frontmatterText ?? '') as Record<string, unknown>;

const manifest = buildManifest('0.0.0', buildRegistry('0.0.0'));
const globalFlags = new Set(manifest.globalFlags.map(f => f.name));

const invocations = [...body!.matchAll(/`?oura-cli ((?:[^`\n#|]|\\`)+?)`?(?=\s*(?:`|#|\||$))/gm)]
  .map(m => m[1]!.trim())
  .filter(Boolean);

const flagNames = (args: ManifestArg[]) => new Set(args.filter(a => a.name.startsWith('--')).map(a => a.name));

function check(line: string): string | null {
  const tokens = line.split(/\s+/);
  const cmd = manifest.commands.find(c => c.name === tokens[0]);
  if (!cmd) return `unknown command "${tokens[0]}"`;
  let scope: { name: string; args: ManifestArg[] } = cmd;
  let rest = tokens.slice(1);
  if ((cmd as ManifestCommand).subcommands) {
    const sub = (cmd as ManifestCommand).subcommands!.find(s => s.name === rest[0]);
    if (!sub) return `unknown subcommand "${cmd.name} ${rest[0]}"`;
    scope = { name: `${cmd.name} ${sub.name}`, args: sub.args };
    rest = rest.slice(1);
  }
  const flags = flagNames(scope.args);
  const collectionArg = scope.args.find(a => a.name === '<collection>');
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok.startsWith('--')) {
      const [flag] = tok.split('=');
      if (!flags.has(flag!) && !globalFlags.has(flag!)) return `unknown flag "${flag}" for ${scope.name}`;
      const takesValue = flag !== '--no-color' && flag !== '--offline';
      if (takesValue && !tok.includes('=')) i++;
      continue;
    }
    positionals.push(tok);
  }
  if (collectionArg && positionals[0] && !positionals[0].startsWith('<') && !collectionArg.values!.includes(positionals[0])) {
    return `unknown collection "${positionals[0]}"`;
  }
  return null;
}

describe('skills/oura-cli/SKILL.md', () => {
  it('has the frontmatter the Agent Skills spec requires, and a name matching its directory', () => {
    expect(frontmatter.name).toBe(basename(dirname(skillPath)));
    expect(frontmatter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeLessThanOrEqual(1024);
    expect(((frontmatter.metadata as any)?.openclaw?.requires?.bins)).toEqual(['oura-cli']);
  });

  // The spec types `metadata` as string → string; OpenClaw and Hermes each read a nested object
  // under their own key (see the comment above `metadata` in the file). The deviation is confined
  // to those two keys, and each object keeps the shape its harness documents.
  it('confines the metadata deviation to the openclaw and hermes keys and keeps their shapes', () => {
    const spec = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
    expect(Object.keys(frontmatter).filter(k => !spec.includes(k))).toEqual([]);
    for (const k of ['name', 'description', 'license', 'compatibility']) expect(typeof frontmatter[k]).toBe('string');

    const metadata = frontmatter.metadata as Record<string, unknown>;
    const vendor = ['openclaw', 'hermes'];
    for (const [k, v] of Object.entries(metadata)) {
      if (!vendor.includes(k)) expect(typeof v).toBe('string');
    }

    // OpenClaw: JSON-serialise the block and read it back the way its loader does.
    const openclaw = JSON.parse(JSON.stringify(metadata)).openclaw;
    expect(typeof openclaw).toBe('object');
    expect(openclaw.requires).toEqual({ bins: ['oura-cli'] });
    expect(openclaw.install).toHaveLength(1);
    expect(['brew', 'node', 'go', 'uv', 'download']).toContain(openclaw.install[0].kind);
    expect(openclaw.install[0].package).toBe('@drakulavich/oura-cli');
    expect(openclaw.install[0].bins).toEqual(['oura-cli']);

    const hermes = metadata.hermes as Record<string, unknown>;
    expect(Array.isArray(hermes.tags) && (hermes.tags as unknown[]).every(t => typeof t === 'string')).toBe(true);
    expect(typeof hermes.category).toBe('string');
  });

  it('mentions enough invocations to be a drift check at all', () => {
    expect(invocations.length).toBeGreaterThan(15);
  });

  it('names only commands, subcommands, flags and collections the CLI has', () => {
    const problems = invocations.map(line => [line, check(line)] as const).filter(([, p]) => p);
    expect(problems).toEqual([]);
  });

  it('lists every collection, verbatim', () => {
    expect(body).toContain(`\`${names().join(' ')}\``);
  });

  it('lists every report recommendation code, verbatim', () => {
    expect(body).toContain(Object.keys(RECOMMENDATIONS).map(c => `\`${c}\``).join(', '));
  });

  it('names only error codes from src/lib/errors.ts', () => {
    // Env vars (`OURA_TOKEN`) appear elsewhere in the same style, so only the errors section counts.
    const section = body!.slice(body!.indexOf('## Errors'), body!.indexOf('## Discovering'));
    const named = [...section.matchAll(/`([A-Z][A-Z_]{3,})`/g)].map(m => m[1]!);
    expect(named.length).toBeGreaterThan(3);
    for (const code of named) expect(ERROR_CODES).toContain(code);
  });
});
