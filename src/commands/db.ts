import { defineCommand } from 'citty';
import { mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { importFromCSV } from '../db/csv-import.js';
import { getDaySummary, getTrends, getStats } from '../db/queries.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats } from '../format.js';
import { todayDate } from './helpers.js';
import { daysBack } from '../lib/time.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { commonArgs, handleError, applyNoColor } from './common.js';
import { runSync } from './sync.js';

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Query and manage the local SQLite database' },
  subCommands: {
    import: defineCommand({
      meta: { name: 'import', description: 'Sync new data from Oura API into local database (alias of sync)' },
      args: { ...commonArgs },
      async run({ args }) {
        applyNoColor(args);
        try {
          await runSync({ format: args.format, db: args.db, token: args.token, tz: args.tz });
        } catch (err) {
          handleError(err, args);
        }
      },
    }),

    today: defineCommand({
      meta: { name: 'today', description: "Today's summary from local database" },
      args: { ...commonArgs },
      run({ args }) {
        applyNoColor(args);
        try {
          const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          const summary = getDaySummary(db, todayDate(args.tz));
          console.log(formatDaySummary(summary, format, 'Run `oura-cli sync` to download your data. Oura publishes a day\'s summary after that night\'s sleep syncs from the ring.'));
          db.close();
        } catch (err) {
          handleError(err, args);
        }
      },
    }),

    date: defineCommand({
      meta: { name: 'date', description: 'Summary for specific date from local database' },
      args: {
        ...commonArgs,
        day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' },
      },
      run({ args }) {
        applyNoColor(args);
        try {
          const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          const summary = getDaySummary(db, args.day);
          console.log(formatDaySummary(summary, format));
          db.close();
        } catch (err) {
          handleError(err, args);
        }
      },
    }),

    week: defineCommand({
      meta: { name: 'week', description: 'Last 7 days from local database' },
      args: { ...commonArgs },
      run({ args }) {
        applyNoColor(args);
        try {
          const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          const days = daysBack(todayDate(args.tz), 7).map(d => getDaySummary(db, d));
          console.log(formatWeekTable(days, format, 'Run `oura-cli sync`, then `oura-cli db week` again.'));
          db.close();
        } catch (err) {
          handleError(err, args);
        }
      },
    }),

    trends: defineCommand({
      meta: { name: 'trends', description: 'Score and metric trends over N days (default: 30)' },
      args: {
        ...commonArgs,
        days: { type: 'positional', required: false, description: 'Window size in days (default: 30)' },
      },
      run({ args }) {
        applyNoColor(args);
        try {
          const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
          const n = args.days ? parseInt(args.days as string, 10) : 30;
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          const trends = getTrends(db, n, todayDate(args.tz));
          console.log(formatTrends(trends, n, format));
          db.close();
        } catch (err) {
          handleError(err, args);
        }
      },
    }),

    stats: defineCommand({
      meta: { name: 'stats', description: 'Row counts, date range, and record highs from local database' },
      args: { ...commonArgs },
      run({ args }) {
        applyNoColor(args);
        try {
          const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          const stats = getStats(db, todayDate(args.tz));
          console.log(formatStats(stats, format));
          db.close();
        } catch (err) {
          handleError(err, args);
        }
      },
    }),

    reset: defineCommand({
      meta: { name: 'reset', description: 'Destroy and rebuild database from exported CSV files' },
      args: {
        ...commonArgs,
        force: { type: 'boolean', default: false, description: 'Confirm destructive reset' },
      },
      run({ args }) {
        applyNoColor(args);
        try {
          if (!args.force) {
            console.log(JSON.stringify({ error: 'Use --force to confirm destructive reset.' }));
            process.exit(1);
          }
          const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
          const dbPath = getDbPath({ dbPath: args.db });
          try { unlinkSync(dbPath); } catch { /* file may not exist */ }
          try { unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
          try { unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
          const log = format === 'table' ? console.log : undefined;
          log?.('Database deleted.');
          mkdirSync(dirname(dbPath), { recursive: true });
          const db = openDatabase({ dbPath: args.db });
          ensureSchema(db);
          importFromCSV(db, log ?? (() => {}));
          if (format === 'json') {
            console.log(JSON.stringify({ status: 'reset complete' }));
          }
          db.close();
        } catch (err) {
          handleError(err, args);
        }
      },
    }),
  },
});
