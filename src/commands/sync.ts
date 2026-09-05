import { importDaily } from '../db/import.js';
import { getDaySummary } from '../db/queries.js';
import { formatDaySummary, formatImportSummary } from '../render/format.js';
import { dataCommand, type Ctx, type Output } from './run-command.js';

export async function runSync(ctx: Ctx): Promise<Output> {
  const lines: string[] = [];
  const log = ctx.format === 'table' ? (m: string) => lines.push(m) : undefined;
  const importResult = await importDaily(ctx.db!, ctx.client!, ctx.today, log);
  const today = getDaySummary(ctx.db!, ctx.today);
  return {
    json: { import: importResult, today },
    text: () => [...lines, formatImportSummary(importResult), formatDaySummary(today, 'table')].join('\n'),
  };
}

export const syncCommand = dataCommand({
  meta: { name: 'sync', description: "Import latest data from Oura API and return today's summary" },
  needs: { db: true, client: true },
  run: runSync,
});
