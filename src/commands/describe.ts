import { defineCommand } from 'citty';
import type { ArgDef, ArgsDef, CommandDef, SubCommandsDef } from 'citty';
import { names } from '../collections/index.js';
import { commonArgs } from './common.js';

export interface ManifestArg {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  values?: string[];
}

export interface ManifestSubcommand {
  name: string;
  description: string;
  args: ManifestArg[];
}

export interface ManifestCommand {
  name: string;
  description: string;
  args: ManifestArg[];
  outputSchema?: string;
  /** For commands whose output shape depends on an argument (fetch → collection). */
  outputSchemas?: Record<string, string>;
  subcommands?: ManifestSubcommand[];
}

export interface Manifest {
  name: string;
  version: string;
  compatManifestCommand?: string;
  auth: { envVars: string[]; tokenFile: string; loginCommand: string };
  globalFlags: ManifestArg[];
  exitCodes: { code: number; meaning: string }[];
  commands: ManifestCommand[];
}

const OUTPUT_SCHEMAS: Record<string, string> = { doctor: 'docs/schemas/doctor.json' };
const ENUM_ARGS: Record<string, Record<string, string[]>> = {
  fetch: { collection: names() },
  report: { period: ['week', 'month'] },
};

function resolved(def: SubCommandsDef[string]): CommandDef {
  if (typeof def === 'function' || def instanceof Promise) {
    throw new Error('describe: lazy subcommands are not supported; register plain CommandDef objects.');
  }
  return def as CommandDef;
}

function describeArgs(command: string, args: ArgsDef | undefined): ManifestArg[] {
  const out: ManifestArg[] = [];
  for (const [key, raw] of Object.entries(args ?? {})) {
    // Skip by object identity, not by key name: a command can declare its
    // own arg under a global flag's name (e.g. login's --token means
    // something different from the global --token) and that must still be
    // listed. A command opts into hiding a flag by reusing the shared
    // definition object (e.g. `'no-color': commonArgs['no-color']`).
    if (raw === (commonArgs as ArgsDef)[key]) continue;
    const a = raw as ArgDef & { required?: boolean; options?: readonly string[] };
    const values = ENUM_ARGS[command]?.[key] ?? (a.type === 'enum' ? [...(a.options ?? [])] : undefined);
    if (a.type === 'positional') {
      out.push({ name: a.required ? `<${key}>` : `[${key}]`, type: 'string', required: a.required === true,
        description: a.description, ...(values ? { values } : {}) });
    } else {
      out.push({ name: `--${key}`, type: values ? 'enum' : String(a.type ?? 'string'), required: false,
        description: a.description, ...(values ? { values } : {}) });
    }
  }
  return out;
}

function resolvedMeta(meta: CommandDef['meta']): { description?: string } {
  if (typeof meta === 'function' || meta instanceof Promise) return {};
  return meta ?? {};
}

function describeCommandDef(name: string, def: CommandDef): ManifestCommand {
  const meta = resolvedMeta(def.meta);
  const cmd: ManifestCommand = {
    name,
    description: meta.description ?? '',
    args: describeArgs(name, def.args as ArgsDef | undefined),
  };
  if (OUTPUT_SCHEMAS[name]) cmd.outputSchema = OUTPUT_SCHEMAS[name];
  if (name === 'fetch') cmd.outputSchemas = Object.fromEntries(names().map(n => [n, `docs/schemas/${n}.json`]));
  const subs = def.subCommands as SubCommandsDef | undefined;
  if (subs) {
    cmd.subcommands = Object.entries(subs).map(([subName, subDef]) => {
      const sub = resolved(subDef);
      const subMeta = resolvedMeta(sub.meta);
      return { name: subName, description: subMeta.description ?? '', args: describeArgs(subName, sub.args as ArgsDef | undefined) };
    });
  }
  return cmd;
}

export function buildManifest(version: string, commands: SubCommandsDef): Manifest {
  return {
    name: 'oura-cli',
    version,
    compatManifestCommand: 'oura-cli manifest',
    auth: { envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH'], tokenFile: '~/.oura-token', loginCommand: 'oura-cli login' },
    globalFlags: [
      { name: '--format', type: 'enum', values: ['table', 'json'], description: 'Output format (auto-detected by TTY when omitted)' },
      { name: '--db',     type: 'string', description: 'Override SQLite database path (env: OURA_DB_PATH)' },
      { name: '--tz',     type: 'string', description: 'Display timezone (env: OURA_TZ; default auto-detected)' },
      { name: '--token',  type: 'string', description: 'Inline access token (prefer env vars or `login`)' },
      { name: '--no-color', type: 'boolean', description: 'Disable ANSI colors in human output' },
    ],
    exitCodes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'user error (bad arguments)' },
      { code: 2, meaning: 'auth error (missing or invalid token)' },
      { code: 3, meaning: 'API or network error' },
      { code: 4, meaning: 'database or local storage error' },
    ],
    commands: Object.entries(commands).map(([name, def]) => describeCommandDef(name, resolved(def))),
  };
}

export function describeCommand(version: string, getCommands: () => SubCommandsDef) {
  return defineCommand({
    meta: { name: 'describe', description: 'Emit a machine-readable manifest of commands, args, and outputs.' },
    args: {},
    run() {
      console.log(JSON.stringify(buildManifest(version, getCommands()), null, 2));
    },
  });
}
