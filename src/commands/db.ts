import { defineCommand } from 'citty';
import { byName, names } from '../collections/index.js';
import { getDaySummary, getTrends, getStats, hasDailySummaries } from '../db/queries.js';
import { getRows } from '../db/rows.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats, PUBLISH_DELAY_NOTE } from '../render/format.js';
import { formatRows } from '../render/format-rows.js';
import { CliError } from '../lib/errors.js';
import { daysBack } from '../lib/time.js';
import { assertCalendarDate, assertPositiveInt } from '../lib/validate.js';
import { assertRangeAllowed, resolveRange } from './fetch.js';
import { dataCommand } from './run-command.js';
import { dayCompleteness } from '../db/day-complete.js';

const SYNC_HINT = `Run \`oura-cli sync\` to download your data. ${PUBLISH_DELAY_NOTE}`;
// A cache that already holds days is not waiting for a download: today is not published yet, or the
// ring has not uploaded. "Download your data" here sent users back to a sync that changed nothing (#127).
const TODAY_UNPUBLISHED_HINT = `${PUBLISH_DELAY_NOTE} If the ring has synced since, run \`oura-cli sync\` again.`;

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Query and manage the local SQLite database' },
  subCommands: {
    today: dataCommand({
      meta: { name: 'today', description: "Today's summary from local database" },
      needs: { db: true },
      run(ctx) {
        const summary = getDaySummary(ctx.db!, ctx.today, dayCompleteness(ctx.db!, ctx.today));
        const hint = hasDailySummaries(ctx.db!) ? TODAY_UNPUBLISHED_HINT : SYNC_HINT;
        return { json: summary, text: () => formatDaySummary(summary, 'table', hint) };
      },
    }),

    date: dataCommand({
      meta: { name: 'date', description: 'Summary for specific date from local database' },
      args: { day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' } },
      needs: { db: true },
      run(ctx, args) {
        const day = assertCalendarDate(String(args.day), '<day>');
        const summary = getDaySummary(ctx.db!, day, dayCompleteness(ctx.db!, ctx.today));
        return { json: summary, text: () => formatDaySummary(summary, 'table') };
      },
    }),

    week: dataCommand({
      meta: { name: 'week', description: 'Last 7 days from local database' },
      needs: { db: true },
      run(ctx) {
        const complete = dayCompleteness(ctx.db!, ctx.today); // one read of the activity table, not seven
        const days = daysBack(ctx.today, 7).map(d => getDaySummary(ctx.db!, d, complete));
        return { json: days, text: () => formatWeekTable(days, 'table', 'Run `oura-cli sync`, then `oura-cli db week` again.') };
      },
    }),

    trends: dataCommand({
      meta: { name: 'trends', description: 'Score and metric trends over N days (default: 30)' },
      args: { days: { type: 'positional', required: false, description: 'Window size in days (default: 30)' } },
      needs: { db: true },
      run(ctx, args) {
        const n = args.days === undefined ? 30 : assertPositiveInt(String(args.days), '<days>');
        const trends = getTrends(ctx.db!, n, ctx.today);
        return { json: trends, text: () => formatTrends(trends, n, 'table', 'Run `oura-cli sync`, then `oura-cli db trends` again.') };
      },
    }),

    stats: dataCommand({
      meta: { name: 'stats', description: 'Row counts, date range, and record highs from local database' },
      needs: { db: true },
      run(ctx) {
        const stats = getStats(ctx.db!, ctx.today);
        return { json: stats, text: () => formatStats(stats, 'table', 'Run `oura-cli sync`, then `oura-cli db stats` again.') };
      },
    }),

    // Eight collections were write-only from the user's side: `sync` filled them, `db stats` counted
    // them, and seeing a tag or a battery curve meant `fetch`, which goes back to the API (#73).
    // Same range flags and defaults as `fetch`, so the two are twins: one reads the API, this the cache.
    rows: dataCommand({
      meta: { name: 'rows', description: 'Cached rows of one collection, as stored: the local twin of `fetch`' },
      args: {
        collection: { type: 'positional', required: true, description: `Collection: ${names().join(' | ')} (ring is a snapshot and takes no range flags)` },
        day:  { type: 'string', description: 'Single day (YYYY-MM-DD). Default: today.' },
        from: { type: 'string', description: 'Range start (YYYY-MM-DD); requires --to' },
        to:   { type: 'string', description: 'Range end (YYYY-MM-DD); requires --from' },
        days: { type: 'string', description: 'Last N days ending today' },
        limit: { type: 'string', description: 'Print at most N rows, the earliest first (a day of heart rate is hundreds)' },
      },
      needs: { db: true },
      run(ctx, args) {
        const c = byName(String(args.collection));
        if (!c) throw new CliError('BAD_ARGS', `Unknown collection "${args.collection}".`, `Valid collections: ${names().join(', ')}`);
        const opts = {
          day: args.day as string | undefined, from: args.from as string | undefined,
          to: args.to as string | undefined, days: args.days as string | undefined,
        };
        assertRangeAllowed(c, opts);
        const range = c.rangeParams === 'none' ? null : resolveRange({ ...opts, today: ctx.today });
        const limit = args.limit === undefined ? undefined : assertPositiveInt(String(args.limit), '--limit');
        const all = getRows(ctx.db!, c, range, ctx.tz);
        const rows = limit === undefined ? all : all.slice(0, limit);
        const scope = range === null ? '' : range.start === range.end ? ` for ${range.start}` : ` for ${range.start} → ${range.end}`;
        // A snapshot has no history to reach back into, so it gets no `--from` hint.
        const hint = range === null
          ? `Run \`oura-cli sync\` to fill the cache, or \`oura-cli fetch ${c.name}\` to read the API.`
          : `Run \`oura-cli sync\` (\`sync --from <day>\` for older days), or \`oura-cli fetch ${c.name}\` to read the API.`;
        return { json: rows, text: () => formatRows(c, rows, scope, 'table', hint, undefined, all.length) };
      },
    }),
  },
});
