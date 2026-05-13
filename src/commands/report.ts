import { Command } from 'commander';
import { openDatabase, ensureSchema } from '../db/database.js';
import { getReport } from '../db/report.js';
import { formatReport } from '../format-report.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { CliError } from '../lib/errors.js';

export function reportCommand(): Command {
  return new Command('report')
    .description('Generate a narrative health report from local data.')
    .option('--period <name>', 'Report window: week | month', 'week')
    .action((_, command) => {
      const opts = command.parent!.opts();
      const period = (command.opts() as any).period ?? 'week';
      if (period !== 'week' && period !== 'month') {
        throw new CliError('BAD_ARGS', `--period must be "week" or "month", got "${period}".`);
      }
      const format = resolveFormat({ explicit: opts.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: opts.db });
      ensureSchema(db);
      const days = period === 'week' ? 7 : 30;
      const data = getReport(db, days);
      console.log(formatReport(data, format, period));
      db.close();
    });
}
