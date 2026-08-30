import { defineCommand } from 'citty';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { openDatabase, ensureSchema, getDbPath } from '../db/database.js';
import { importDaily } from '../db/import.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary, formatImportSummary } from '../format.js';
import { getClient, todayDate } from './helpers.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { commonArgs, handleError, applyNoColor } from './common.js';

export async function runSync(opts: { format?: string; db?: string; token?: string; tz?: string }): Promise<void> {
  const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
  const dbPath = getDbPath({ dbPath: opts.db });
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase({ dbPath: opts.db });
  ensureSchema(db);
  const client = getClient(opts);
  const log = format === 'table' ? console.log : undefined;
  const importResult = await importDaily(db, client, log);
  const today = getDaySummary(db, todayDate(opts.tz));
  db.close();

  if (format === 'json') {
    console.log(JSON.stringify({ import: importResult, today }, null, 2));
  } else {
    console.log(formatImportSummary(importResult));
    console.log(formatDaySummary(today, format));
  }
}

export const syncCommand = defineCommand({
  meta: { name: 'sync', description: "Import latest data from Oura API and return today's summary" },
  args: { ...commonArgs },
  async run({ args }) {
    applyNoColor(args);
    try {
      await runSync({ format: args.format, db: args.db, token: args.token, tz: args.tz });
    } catch (err) {
      handleError(err, args);
    }
  },
});
