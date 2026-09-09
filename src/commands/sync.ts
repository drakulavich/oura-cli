import { importDaily } from '../db/sync.js';
import type { SyncWindow, SyncOptions } from '../db/sync.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary, formatImportSummary } from '../render/format.js';
import { CliError } from '../lib/errors.js';
import { assertCalendarDate } from '../lib/validate.js';
import { byName, names } from '../collections/index.js';
import { dataCommand, type Ctx, type Output, type DataCommandDef } from './run-command.js';
import type { ArgsDef } from 'citty';

export function resolveWindow(opts: { from?: string; to?: string }, today: string): SyncWindow {
  if (opts.to !== undefined && opts.from === undefined) throw new CliError('BAD_ARGS', '--to requires --from.');
  const from = opts.from === undefined ? undefined : assertCalendarDate(opts.from, '--from');
  const to = opts.to === undefined ? undefined : assertCalendarDate(opts.to, '--to');
  if (from !== undefined && to !== undefined && from > to) throw new CliError('BAD_ARGS', `--from (${from}) must not be after --to (${to}).`);
  // Without --to the window ends today. An explicit --from past it is a mistake worth naming:
  // the sync would otherwise be clamped to today and quietly fetch a window nobody asked for.
  const end = to ?? today;
  if (from !== undefined && from > end) {
    throw new CliError('BAD_ARGS', `--from (${from}) is after the end of the window (${end}).`,
      'Pass --to as well to sync a window that ends in the future.');
  }
  return { from, to };
}

/** The one `--prune` value that is not a collection name; no collection may claim it. */
const PRUNE_ALL = 'all';

/**
 * Which collections `--prune` covers this run.
 *
 * `--prune` carries names, so it is a string arg, and a bare `--prune` then swallows whatever comes
 * next: `sync --prune --db x.db` binds `--db` as the value and leaves the path as a stray
 * positional. Every "prune everything" spelling therefore has to be a value — `--prune=all` — and a
 * bare one is refused with both spellings in the hint, rather than quietly meaning something the
 * user did not write. A value starting with `-` gets the same treatment for the same reason,
 * though `assertKnownArgs` usually rejects the stray positional before this is reached.
 */
export function resolvePruneScope(value: unknown): SyncOptions['prune'] {
  if (value === undefined || value === false) return undefined;
  const raw = value === true ? '' : String(value);
  const wanted = raw.split(',').map(s => s.trim()).filter(s => s !== '');
  if (wanted.length === 0 || wanted.some(n => n.startsWith('-'))) {
    throw new CliError('BAD_ARGS', '--prune needs a value naming what to prune.',
      `Use --prune=<collection> (for example --prune=hr), a comma-separated list, or --prune=${PRUNE_ALL} for every collection.`);
  }
  if (wanted.length === 1 && wanted[0] === PRUNE_ALL) return PRUNE_ALL;
  const unknown = wanted.filter(n => byName(n) === undefined);
  if (unknown.length > 0) {
    throw new CliError('BAD_ARGS', `--prune: unknown collection${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`,
      `Known collections: ${names().join(', ')}.`);
  }
  return wanted;
}

export async function runSync(ctx: Ctx, window: SyncWindow = {}, options: SyncOptions = {}): Promise<Output> {
  const lines: string[] = [];
  const log = ctx.format === 'table' ? (m: string) => lines.push(m) : undefined;
  const importResult = await importDaily(ctx.db!, ctx.client!, { today: ctx.today, tz: ctx.tz }, log, window, options);
  const today = getDaySummary(ctx.db!, ctx.today);
  return {
    json: { import: importResult, today },
    text: () => [...lines, formatImportSummary(importResult), formatDaySummary(today, 'table')].join('\n'),
  };
}

const syncArgs = {
  from:  { type: 'string', description: 'Re-fetch every collection from this day (YYYY-MM-DD) instead of from its last stored day' },
  to:    { type: 'string', description: 'End of the explicit window (YYYY-MM-DD, default: today); requires --from' },
  prune: { type: 'string', description: 'Delete cached rows the API no longer returns even when it dropped most of a response: --prune=hr, a comma-separated list, or --prune=all — use after sync names a collection whose rows it kept' },
} as const satisfies ArgsDef;

/** Exported apart from the command so a test can drive the args-to-options mapping through `execute`. */
export const syncDef: DataCommandDef<typeof syncArgs> = {
  meta: { name: 'sync', description: "Import latest data from Oura API and return today's summary" },
  args: syncArgs,
  needs: { db: true, client: true },
  run: (ctx, args) => runSync(
    ctx,
    resolveWindow({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx.today),
    { prune: resolvePruneScope(args.prune) },
  ),
};

export const syncCommand = dataCommand(syncDef);
