import { importDaily } from '../db/sync.js';
import type { SyncWindow } from '../db/sync.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary, formatImportSummary } from '../render/format.js';
import { CliError } from '../lib/errors.js';
import { assertCalendarDate } from '../lib/validate.js';
import { dataCommand, type Ctx, type Output } from './run-command.js';

export function resolveWindow(opts: { from?: string; to?: string }): SyncWindow {
  if (opts.to !== undefined && opts.from === undefined) throw new CliError('BAD_ARGS', '--to requires --from.');
  const from = opts.from === undefined ? undefined : assertCalendarDate(opts.from, '--from');
  const to = opts.to === undefined ? undefined : assertCalendarDate(opts.to, '--to');
  if (from !== undefined && to !== undefined && from > to) throw new CliError('BAD_ARGS', `--from (${from}) must not be after --to (${to}).`);
  return { from, to };
}

export async function runSync(ctx: Ctx, window: SyncWindow = {}): Promise<Output> {
  const lines: string[] = [];
  const log = ctx.format === 'table' ? (m: string) => lines.push(m) : undefined;
  const importResult = await importDaily(ctx.db!, ctx.client!, { today: ctx.today, tz: ctx.tz }, log, window);
  const today = getDaySummary(ctx.db!, ctx.today);
  return {
    json: { import: importResult, today },
    text: () => [...lines, formatImportSummary(importResult), formatDaySummary(today, 'table')].join('\n'),
  };
}

export const syncCommand = dataCommand({
  meta: { name: 'sync', description: "Import latest data from Oura API and return today's summary" },
  args: {
    from: { type: 'string', description: 'Re-fetch every collection from this day (YYYY-MM-DD) instead of from its last stored day' },
    to:   { type: 'string', description: 'End of the explicit window (YYYY-MM-DD, default: today); requires --from' },
  },
  needs: { db: true, client: true },
  run: (ctx, args) => runSync(ctx, resolveWindow({ from: args.from as string | undefined, to: args.to as string | undefined })),
});
