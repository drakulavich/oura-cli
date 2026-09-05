import chalk from 'chalk';
import { defineCommand } from 'citty';
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from 'citty';
import { SQLiteError } from 'bun:sqlite';
import { openDatabase, ensureSchema, DB_HINT } from '../db/open.js';
import type { Database } from '../db/open.js';
import { CliError } from '../lib/errors.js';
import { OuraClient } from '../api/client.js';
import { formatError, exitCodeFor } from '../lib/errors.js';
import { resolveFormat, type OutputFormat } from '../lib/format-resolve.js';
import { today, resolveDefaultTimezone } from '../lib/time.js';
import { assertTimezone } from '../lib/validate.js';
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
  let exitCode = 0;
  try {
    // Resolve --format for every command so an unknown value is always rejected, and so
    // errors from jsonOnly commands are still rendered for the terminal the user is on.
    format = resolveFormat({ explicit: args.format as string | undefined, isTty: io.isTty });
    const outputFormat: OutputFormat = def.jsonOnly ? 'json' : format;
    const tz = assertTimezone((args.tz as string | undefined) ?? resolveDefaultTimezone());
    const ctx: Ctx = { format: outputFormat, tz, today: today(tz) };
    if (def.needs?.db) {
      db = openDatabase(args.db as string | undefined);
      ensureSchema(db);
      ctx.db = db;
    }
    if (def.needs?.client) {
      ctx.client = new OuraClient(args.token ? { token: args.token as string } : {});
    }
    const out = await def.run(ctx, args);
    io.stdout(outputFormat === 'json' ? JSON.stringify(out.json, null, 2) : out.text());
    exitCode = out.exitCode ?? 0;
  } catch (raw) {
    // A query failing inside run() (corrupt file, missing table) is a DB_ERROR, not UNKNOWN.
    const err = raw instanceof SQLiteError ? new CliError('DB_ERROR', raw.message, DB_HINT) : raw;
    io.stderr(formatError(err, format).text);
    exitCode = exitCodeFor(err);
  } finally {
    db?.close();
  }
  // io.exit is called only after the finally above has run, so a real
  // process.exit (which terminates synchronously) never skips DB cleanup.
  if (exitCode !== 0) io.exit(exitCode);
}

export function dataCommand<A extends ArgsDef>(def: DataCommandDef<A>): CommandDef<A & CommonArgsDef> {
  return defineCommand({
    meta: def.meta,
    args: { ...commonArgs, ...(def.args ?? {}) } as A & CommonArgsDef,
    run: ({ args }) => execute(def, args as ParsedArgs<A & CommonArgsDef>, processIo),
  }) as CommandDef<A & CommonArgsDef>;
}
