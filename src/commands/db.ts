import { defineCommand } from 'citty';
import { getDaySummary, getTrends, getStats } from '../db/queries.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats, PUBLISH_DELAY_NOTE } from '../render/format.js';
import { daysBack } from '../lib/time.js';
import { assertCalendarDate, assertPositiveInt } from '../lib/validate.js';
import { dataCommand } from './run-command.js';
import { dayCompleteness } from '../db/day-complete.js';

const SYNC_HINT = `Run \`oura-cli sync\` to download your data. ${PUBLISH_DELAY_NOTE}`;

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Query and manage the local SQLite database' },
  subCommands: {
    today: dataCommand({
      meta: { name: 'today', description: "Today's summary from local database" },
      needs: { db: true },
      run(ctx) {
        const summary = getDaySummary(ctx.db!, ctx.today, dayCompleteness(ctx.db!, ctx.today));
        return { json: summary, text: () => formatDaySummary(summary, 'table', SYNC_HINT) };
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
  },
});
