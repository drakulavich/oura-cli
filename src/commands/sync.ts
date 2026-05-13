import { Command } from 'commander';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { importDaily } from '../db/import.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary } from '../format.js';
import { getClient, todayDate } from './helpers.js';
import { resolveFormat } from '../lib/format-resolve.js';

export async function runSync(opts: { format?: string; db?: string; token?: string }): Promise<void> {
  const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
  const dbPath = getDbPath({ dbPath: opts.db });
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase({ dbPath: opts.db });
  ensureSchema(db);
  const client = getClient(opts);
  const log = format === 'table' ? console.log : undefined;
  const importResult = await importDaily(db, client, log);
  const today = getDaySummary(db, todayDate());
  db.close();

  if (format === 'json') {
    console.log(JSON.stringify({ import: importResult, today }, null, 2));
  } else {
    console.log(formatDaySummary(today, format));
  }
}

export function syncCommand(): Command {
  return new Command('sync')
    .description('Import latest data from Oura API and return today\'s summary')
    .action(async (_, command) => {
      const opts = command.parent!.opts();
      await runSync(opts);
    });
}
