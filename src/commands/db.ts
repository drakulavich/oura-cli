import { defineCommand } from 'citty';
import { getDaySummary, getTrends, getStats } from '../db/queries.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats } from '../render/format.js';
import { assertCalendarDate, daysBack } from '../lib/time.js';
import { dataCommand } from './run-command.js';

const SYNC_HINT = 'Run `oura-cli sync` to download your data. Oura publishes a day\'s summary after that night\'s sleep syncs from the ring.';

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Query and manage the local SQLite database' },
  subCommands: {
    today: dataCommand({
      meta: { name: 'today', description: "Today's summary from local database" },
      needs: { db: true },
      run(ctx) {
        const summary = getDaySummary(ctx.db!, ctx.today);
        return { json: summary, text: () => formatDaySummary(summary, 'table', SYNC_HINT) };
      },
    }),

    date: dataCommand({
      meta: { name: 'date', description: 'Summary for specific date from local database' },
      args: { day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' } },
      needs: { db: true },
      run(ctx, args) {
        const day = assertCalendarDate(String(args.day), 'day');
        const summary = getDaySummary(ctx.db!, day);
        return { json: summary, text: () => formatDaySummary(summary, 'table') };
      },
    }),

    week: dataCommand({
      meta: { name: 'week', description: 'Last 7 days from local database' },
      needs: { db: true },
      run(ctx) {
        const days = daysBack(ctx.today, 7).map(d => getDaySummary(ctx.db!, d));
        return { json: days, text: () => formatWeekTable(days, 'table', 'Run `oura-cli sync`, then `oura-cli db week` again.') };
      },
    }),

    trends: dataCommand({
      meta: { name: 'trends', description: 'Score and metric trends over N days (default: 30)' },
      args: { days: { type: 'positional', required: false, description: 'Window size in days (default: 30)' } },
      needs: { db: true },
      run(ctx, args) {
        const n = args.days ? parseInt(String(args.days), 10) : 30;
        const trends = getTrends(ctx.db!, n, ctx.today);
        return { json: trends, text: () => formatTrends(trends, n, 'table') };
      },
    }),

    stats: dataCommand({
      meta: { name: 'stats', description: 'Row counts, date range, and record highs from local database' },
      needs: { db: true },
      run(ctx) {
        const stats = getStats(ctx.db!, ctx.today);
        return { json: stats, text: () => formatStats(stats, 'table') };
      },
    }),
  },
});
