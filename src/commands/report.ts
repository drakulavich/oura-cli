import { getReport } from '../db/report.js';
import { formatReport } from '../render/format-report.js';
import { CliError } from '../lib/errors.js';
import { dataCommand } from './run-command.js';

export const reportCommand = dataCommand({
  meta: { name: 'report', description: 'Generate a narrative health report from local data.' },
  args: { period: { type: 'string', description: 'Report window: week | month', default: 'week' } },
  needs: { db: true },
  run(ctx, args) {
    const period = args.period;
    if (period !== 'week' && period !== 'month') {
      throw new CliError('BAD_ARGS', `--period must be "week" or "month", got "${period}".`);
    }
    const data = getReport(ctx.db!, period === 'week' ? 7 : 30, ctx.today);
    return { json: data, text: () => formatReport(data, 'table', period) };
  },
});
