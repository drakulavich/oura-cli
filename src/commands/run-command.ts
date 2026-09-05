import chalk from 'chalk';
import { defineCommand } from 'citty';
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from 'citty';
import type { Database } from '../lib/db.js';
import { openDatabase, ensureSchema } from '../db/database.js';
import { OuraClient } from '../api/client.js';
import { formatError, exitCodeFor } from '../lib/errors.js';
import { resolveFormat, type OutputFormat } from '../lib/format-resolve.js';
import { today, resolveDefaultTimezone } from '../lib/time.js';
import { commonArgs } from './common.js';

export type CommonArgsDef = typeof commonArgs;

export interface Ctx {
  format: OutputFormat;
  tz: string;
  /** YYYY-MM-DD in `tz` */
  today: string;
  db?: Database;
  client?: OuraClient;
}

export interface Output {
  json: unknown;
  /** Rendered only when format === 'table' */
  text: () => string;
  /** Defaults to 0 */
  exitCode?: number;
}

export interface RunnerIo {
  stdout(s: string): void;
  stderr(s: string): void;
  exit(code: number): void;
  isTty: boolean;
}

export interface DataCommandDef<A extends ArgsDef> {
  meta: CommandMeta;
  args?: A;
  needs?: { db?: boolean; client?: boolean };
  jsonOnly?: boolean;
  run: (ctx: Ctx, args: ParsedArgs<A & CommonArgsDef>) => Output | Promise<Output>;
}

export const processIo: RunnerIo = {
  stdout: s => { process.stdout.write(s + '\n'); },
  stderr: s => { process.stderr.write(s + '\n'); },
  exit: code => process.exit(code),
  isTty: process.stdout.isTTY === true,
};

export async function execute<A extends ArgsDef>(
  def: DataCommandDef<A>,
  args: ParsedArgs<A & CommonArgsDef>,
  io: RunnerIo = processIo,
): Promise<void> {
  if (args['no-color'] || process.env.NO_COLOR) chalk.level = 0;
  let db: Database | undefined;
  let format: OutputFormat = io.isTty ? 'table' : 'json';
  try {
    format = def.jsonOnly
      ? 'json'
      : resolveFormat({ explicit: args.format as string | undefined, isTty: io.isTty });
    const tz = (args.tz as string | undefined) ?? resolveDefaultTimezone();
    const ctx: Ctx = { format, tz, today: today(tz) };
    if (def.needs?.db) {
      db = openDatabase({ dbPath: args.db as string | undefined });
      ensureSchema(db);
      ctx.db = db;
    }
    if (def.needs?.client) {
      ctx.client = new OuraClient(args.token ? { token: args.token as string } : {});
    }
    const out = await def.run(ctx, args);
    io.stdout(format === 'json' ? JSON.stringify(out.json, null, 2) : out.text());
    if (out.exitCode) io.exit(out.exitCode);
  } catch (err) {
    io.stderr(formatError(err, format).text);
    io.exit(exitCodeFor(err));
  } finally {
    db?.close();
  }
}

export function dataCommand<A extends ArgsDef>(def: DataCommandDef<A>): CommandDef<A & CommonArgsDef> {
  return defineCommand({
    meta: def.meta,
    args: { ...commonArgs, ...(def.args ?? {}) } as A & CommonArgsDef,
    run: ({ args }) => execute(def, args as ParsedArgs<A & CommonArgsDef>, processIo),
  }) as CommandDef<A & CommonArgsDef>;
}
