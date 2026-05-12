import { Command } from 'commander';
import { mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { importDaily } from '../db/import.js';
import { importFromCSV } from '../db/csv-import.js';
import { getDaySummary, getTrends, getStats } from '../db/queries.js';
import { formatDaySummary, formatWeekTable, formatTrends, formatStats } from '../format.js';
import { getClient, todayDate } from './helpers.js';
import { resolveFormat } from '../lib/format-resolve.js';

export function dbCommand(): Command {
  const cmd = new Command('db').description('Query and manage the local SQLite database');

  cmd.command('import')
    .description('Sync new data from Oura API into local database')
    .action(async (_, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const dbPath = getDbPath({ dbPath: opts.db });
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const client = getClient(opts);
      const log = format === 'table' ? console.log : undefined;
      const result = await importDaily(db, client, log);
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      }
      db.close();
    });

  cmd.command('today')
    .description("Today's summary from local database")
    .action((_, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const summary = getDaySummary(db, todayDate());
      console.log(formatDaySummary(summary, format));
      db.close();
    });

  cmd.command('date <day>')
    .description('Summary for specific date from local database')
    .action((day: string, _, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const summary = getDaySummary(db, day);
      console.log(formatDaySummary(summary, format));
      db.close();
    });

  cmd.command('week')
    .description('Last 7 days from local database')
    .action((_, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const days: ReturnType<typeof getDaySummary>[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        days.push(getDaySummary(db, d));
      }
      console.log(formatWeekTable(days, format));
      db.close();
    });

  cmd.command('trends [days]')
    .description('Score and metric trends over N days (default: 30)')
    .action((days: string | undefined, _, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const n = days ? parseInt(days, 10) : 30;
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const trends = getTrends(db, n);
      console.log(formatTrends(trends, n, format));
      db.close();
    });

  cmd.command('stats')
    .description('Row counts, date range, and record highs from local database')
    .action((_, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const stats = getStats(db);
      console.log(formatStats(stats, format));
      db.close();
    });

  cmd.command('reset')
    .description('Destroy and rebuild database from exported CSV files')
    .option('--force', 'Confirm destructive reset')
    .action((resetOpts, command) => {
      if (!resetOpts.force) {
        console.log(JSON.stringify({ error: 'Use --force to confirm destructive reset.' }));
        process.exit(1);
      }
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const dbPath = getDbPath({ dbPath: opts.db });
      try { unlinkSync(dbPath); } catch { /* file may not exist */ }
      try { unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
      try { unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
      const log = format === 'table' ? console.log : undefined;
      log?.('Database deleted.');
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      importFromCSV(db, log ?? (() => {}));
      if (format === 'json') {
        console.log(JSON.stringify({ status: 'reset complete' }));
      }
      db.close();
    });

  return cmd;
}
