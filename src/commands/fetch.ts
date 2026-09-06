import { OuraClient } from '../api/client.js';
import { byName, fetchCollection, names } from '../collections/index.js';
import type { AnyCollection } from '../collections/types.js';
import { CliError } from '../lib/errors.js';
import { shiftDay } from '../lib/time.js';
import { assertCalendarDate, assertPositiveInt } from '../lib/validate.js';
import { dataCommand } from './run-command.js';

export function resolveRange(opts: { day?: string; from?: string; to?: string; days?: string; today: string }): { start: string; end: string } {
  const modes = [opts.day !== undefined, opts.from !== undefined || opts.to !== undefined, opts.days !== undefined].filter(Boolean).length;
  if (modes > 1) throw new CliError('BAD_ARGS', 'Use only one of --day, --from/--to, or --days.');
  if (opts.day !== undefined) {
    const d = assertCalendarDate(opts.day, '--day');
    return { start: d, end: d };
  }
  if (opts.from !== undefined || opts.to !== undefined) {
    if (opts.from === undefined || opts.to === undefined) throw new CliError('BAD_ARGS', '--from and --to must be given together.');
    const start = assertCalendarDate(opts.from, '--from');
    const end = assertCalendarDate(opts.to, '--to');
    if (start > end) throw new CliError('BAD_ARGS', `--from (${start}) must not be after --to (${end}).`);
    return { start, end };
  }
  if (opts.days !== undefined) {
    const n = assertPositiveInt(opts.days, '--days');
    return { start: shiftDay(opts.today, -(n - 1)), end: opts.today };
  }
  return { start: opts.today, end: opts.today };
}

/** A snapshot collection (`rangeParams: 'none'`) takes no range flags; silently ignoring them would be #50 again. */
export function assertRangeAllowed(c: AnyCollection, opts: { day?: string; from?: string; to?: string; days?: string }): void {
  if (c.rangeParams === 'none' && [opts.day, opts.from, opts.to, opts.days].some(v => v !== undefined)) {
    throw new CliError('BAD_ARGS', `"${c.name}" is a snapshot, not a day range; it takes no --day, --from/--to or --days.`);
  }
}

export const fetchCommand = dataCommand({
  meta: { name: 'fetch', description: 'Fetch raw records for one Oura collection straight from the API (JSON).' },
  args: {
    collection: { type: 'positional', required: true, description: `Collection: ${names().join(' | ')} (ring is a snapshot and takes no range flags)` },
    day:  { type: 'string', description: 'Single day (YYYY-MM-DD). Default: today.' },
    from: { type: 'string', description: 'Range start (YYYY-MM-DD); requires --to' },
    to:   { type: 'string', description: 'Range end (YYYY-MM-DD); requires --from' },
    days: { type: 'string', description: 'Last N days ending today' },
  },
  jsonOnly: true,
  async run(ctx, args) {
    // Validate arguments before touching the token so BAD_ARGS wins over TOKEN_MISSING.
    const c = byName(args.collection);
    if (!c) throw new CliError('BAD_ARGS', `Unknown collection "${args.collection}".`, `Valid collections: ${names().join(', ')}`);
    const opts = {
      day: args.day as string | undefined, from: args.from as string | undefined,
      to: args.to as string | undefined, days: args.days as string | undefined,
    };
    assertRangeAllowed(c, opts);
    const { start, end } = resolveRange({ ...opts, today: ctx.today });
    const client = new OuraClient(args.token ? { token: args.token as string } : {});
    const data = await fetchCollection(client, c, start, end, ctx.tz);
    return { json: data, text: () => JSON.stringify(data, null, 2) };
  },
});
