import { importDaily } from '../db/sync.js';
import type { SyncWindow, SyncOptions } from '../db/sync.js';
import { getDaySummary } from '../db/queries.js';
import { dayCompleteness } from '../db/day-complete.js';
import { formatDaySummary, formatImportSummary, PUBLISH_DELAY_NOTE } from '../render/format.js';
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

/**
 * The one `--prune` value that is not a collection name. Reserved: a collection called `all` would
 * silently turn `--prune=all` from "that collection" into "every collection", widening a destructive
 * flag by way of an unrelated registry addition. `collections/index.test.ts` holds the line.
 */
export const PRUNE_ALL = 'all';

/**
 * Which collections `--prune` covers this run.
 *
 * `--prune` carries names, so it is a string arg, and a bare `--prune` then swallows whatever comes
 * next: `sync --prune --db x.db` binds `--db` as the value and leaves the path as a stray
 * positional. Every "prune everything" spelling therefore has to be a value — `--prune=all` — and a
 * bare one is refused with both spellings in the hint, rather than quietly meaning something the
 * user did not write. The leading-dash check is load-bearing rather than belt-and-braces: in the
 * space form `assertKnownArgs` does reject the stray positional first, but `sync --prune --db=x.db`
 * leaves no positional at all — `db` is simply undefined, the default cache would be opened, and
 * this is the only thing that stops it.
 */
export function resolvePruneScope(value: unknown): SyncOptions['prune'] {
  if (value === undefined || value === false) return undefined;
  const raw = value === true ? '' : String(value);
  const wanted = raw.split(',').map(s => s.trim()).filter(s => s !== '');
  if (wanted.length === 0 || wanted.some(n => n.startsWith('-'))) {
    throw new CliError('BAD_ARGS', '--prune needs a value naming what to prune.',
      `Use --prune=<collection> (for example --prune=hr), a comma-separated list, or --prune=${PRUNE_ALL} for every collection.`);
  }
  if (wanted.includes(PRUNE_ALL)) {
    if (wanted.length === 1) return PRUNE_ALL;
    throw new CliError('BAD_ARGS', `--prune=${PRUNE_ALL} cannot be combined with collection names.`,
      `Use --prune=${PRUNE_ALL} on its own, or list the collections you mean.`);
  }
  const unknown = wanted.filter(n => byName(n) === undefined);
  if (unknown.length > 0) {
    throw new CliError('BAD_ARGS', `--prune: unknown collection${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`,
      `Known collections: ${names().join(', ')}.`);
  }
  return [...new Set(wanted)];
}

/** Under an empty today panel after a sync: the data is not late, Oura has not published it yet (#61). */
export const TODAY_HINT_AFTER_SYNC = `${PUBLISH_DELAY_NOTE} Run \`oura-cli sync\` again later.`;

export async function runSync(ctx: Ctx, window: SyncWindow = {}, options: SyncOptions = {}): Promise<Output> {
  const lines: string[] = [];
  const log = ctx.format === 'table' ? (m: string) => lines.push(m) : undefined;
  const importResult = await importDaily(ctx.db!, ctx.client!, { today: ctx.today, tz: ctx.tz }, log, window, options);
  const today = getDaySummary(ctx.db!, ctx.today, dayCompleteness(ctx.db!, ctx.today));
  return {
    json: { import: importResult, today },
    text: () => [...lines, formatImportSummary(importResult), formatDaySummary(today, 'table', TODAY_HINT_AFTER_SYNC)].join('\n'),
  };
}

const syncArgs = {
  from:  { type: 'string', description: 'Re-fetch every collection from this day (YYYY-MM-DD) instead of from its last stored day' },
  to:    { type: 'string', description: 'End of the explicit window (YYYY-MM-DD, default: today); requires --from' },
  prune: { type: 'string', description: 'Apply removals sync kept back: --prune=hr, a list, or --prune=all' },
} as const satisfies ArgsDef;

/** Exported apart from the command so a test can drive the args-to-options mapping through `execute`. */
export const syncDef: DataCommandDef<typeof syncArgs> = {
  meta: { name: 'sync', description: 'Download new Oura data into the local cache and report what each collection fetched' },
  args: syncArgs,
  needs: { db: true, client: true },
  run: (ctx, args) => runSync(
    ctx,
    resolveWindow({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx.today),
    { prune: resolvePruneScope(args.prune) },
  ),
};

export const syncCommand = dataCommand(syncDef);
