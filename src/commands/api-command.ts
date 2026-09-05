import { defineCommand } from 'citty';
import { shiftDay } from '../lib/time.js';
import type { OuraEndpoint } from '../api/types.js';
import { dataCommand, type Ctx } from './run-command.js';

function fetchRange(ctx: Ctx, endpoint: OuraEndpoint, start: string, end: string) {
  return ctx.client!.fetch(endpoint, start, end).then(data => ({ json: data, text: () => JSON.stringify(data, null, 2) }));
}

export function createApiCommand(name: string, description: string, endpoint: OuraEndpoint) {
  return defineCommand({
    meta: { name, description },
    subCommands: {
      today: dataCommand({
        meta: { name: 'today', description: `Today's ${name} data` },
        needs: { client: true }, jsonOnly: true,
        run: ctx => fetchRange(ctx, endpoint, ctx.today, ctx.today),
      }),
      date: dataCommand({
        meta: { name: 'date', description: `${name} data for a specific date (YYYY-MM-DD)` },
        args: { day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' } },
        needs: { client: true }, jsonOnly: true,
        run: (ctx, args) => fetchRange(ctx, endpoint, args.day, args.day),
      }),
      week: dataCommand({
        meta: { name: 'week', description: `Last 7 days of ${name} data` },
        needs: { client: true }, jsonOnly: true,
        run: ctx => fetchRange(ctx, endpoint, shiftDay(ctx.today, -6), ctx.today),
      }),
    },
  });
}
