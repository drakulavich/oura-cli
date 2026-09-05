import { defineCommand } from 'citty';
import { mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { importFromCSV } from '../db/csv-import.js';
import { getDaySummary, getTrends, getStats } from '../db/queries.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats } from '../render/format.js';
import { daysBack } from '../lib/time.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { emitError, exitCodeFor } from '../lib/errors.js';
import { commonArgs } from './common.js';
import { dataCommand } from './run-command.js';
import { runSync } from './sync.js';

const SYNC_HINT = 'Run `oura-cli sync` to download your data. Oura publishes a day\'s summary after that night\'s sleep syncs from the ring.';

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Query and manage the local SQLite database' },
  subCommands: {
    import: dataCommand({
      meta: { name: 'import', description: 'Sync new data from Oura API into local database (alias of sync)' },
      needs: { db: true, client: true },
      run: runSync,
    }),

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
        const summary = getDaySummary(ctx.db!, args.day);
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

    // Deleted in PR 4; kept on the old style until then so this PR stays mechanical.
    reset: defineCommand({
      meta: { name: 'reset', description: 'Destroy and rebuild database from exported CSV files' },
      args: { ...commonArgs, force: { type: 'boolean', default: false, description: 'Confirm destructive reset' } },
      run({ args }) {
        const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
        try {
          if (!args.force) {
            console.log(JSON.stringify({ error: 'Use --force to confirm destructive reset.' }));
            process.exit(1);
          }
          const dbPath = getDbPath({ dbPath: args.db });
          for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(dbPath + suffix); } catch { /* absent */ } }
          const log = format === 'table' ? console.log : () => {};
          log('Database deleted.');
          mkdirSync(dirname(dbPath), { recursive: true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          importFromCSV(db, log);
          if (format === 'json') console.log(JSON.stringify({ status: 'reset complete' }));
          db.close();
        } catch (err) {
          emitError(err, format);
          process.exit(exitCodeFor(err));
        }
      },
    }),
  },
});
