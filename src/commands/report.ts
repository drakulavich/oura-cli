import { defineCommand } from 'citty';
import { openDatabase, ensureSchema } from '../db/database.js';
import { getReport } from '../db/report.js';
import { formatReport } from '../format-report.js';
import { resolveFormat } from '../lib/format-resolve.js';
import { CliError } from '../lib/errors.js';
import { commonArgs, handleError, applyNoColor } from './common.js';

export const reportCommand = defineCommand({
  meta: { name: 'report', description: 'Generate a narrative health report from local data.' },
  args: {
    ...commonArgs,
    period: { type: 'string', description: 'Report window: week | month', default: 'week' },
  },
  run({ args }) {
    applyNoColor(args);
    try {
      const period = args.period;
      if (period !== 'week' && period !== 'month') {
        throw new CliError('BAD_ARGS', `--period must be "week" or "month", got "${period}".`);
      }
      const format = resolveFormat({ explicit: args.format, isTty: process.stdout.isTTY === true });
      const db = openDatabase({ dbPath: args.db });
      ensureSchema(db);
      const days = period === 'week' ? 7 : 30;
      const data = getReport(db, days);
      console.log(formatReport(data, format, period));
      db.close();
    } catch (err) {
      handleError(err, args);
    }
  },
});
