import { Command } from 'commander';
import { openDatabase, ensureSchema } from '../db/database.js';
import { getWeeklyReport } from '../db/report.js';
import { formatWeeklyReport } from '../format-report.js';
import { resolveFormat } from '../lib/format-resolve.js';

export function reportCommand(): Command {
  const cmd = new Command('report').description('Generate health reports from local data');

  cmd.command('weekly')
    .description('Weekly health summary with trends and recommendations')
    .action((_, command) => {
      const opts = command.parent!.parent!.opts();
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const data = getWeeklyReport(db);
      console.log(formatWeeklyReport(data, format));
      db.close();
    });

  return cmd;
}
