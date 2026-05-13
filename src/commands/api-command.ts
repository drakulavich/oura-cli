import { defineCommand } from 'citty';
import { getClient, todayDate, dateRange } from './helpers.js';
import { commonArgs, handleError, applyNoColor } from './common.js';
import type { OuraEndpoint } from '../api/types.js';

export function createApiCommand(name: string, description: string, endpoint: OuraEndpoint) {
  return defineCommand({
    meta: { name, description },
    subCommands: {
      today: defineCommand({
        meta: { name: 'today', description: `Today's ${name} data` },
        args: { ...commonArgs },
        async run({ args }) {
          applyNoColor(args);
          try {
            const client = getClient({ token: args.token });
            const day = todayDate(args.tz);
            const data = await client.fetch(endpoint, day, day);
            console.log(JSON.stringify(data, null, 2));
          } catch (err) {
            handleError(err, args);
          }
        },
      }),
      date: defineCommand({
        meta: { name: 'date', description: `${name} data for a specific date (YYYY-MM-DD)` },
        args: {
          ...commonArgs,
          day: { type: 'positional', required: true, description: 'Target date (YYYY-MM-DD)' },
        },
        async run({ args }) {
          applyNoColor(args);
          try {
            const client = getClient({ token: args.token });
            const data = await client.fetch(endpoint, args.day, args.day);
            console.log(JSON.stringify(data, null, 2));
          } catch (err) {
            handleError(err, args);
          }
        },
      }),
      week: defineCommand({
        meta: { name: 'week', description: `Last 7 days of ${name} data` },
        args: { ...commonArgs },
        async run({ args }) {
          applyNoColor(args);
          try {
            const client = getClient({ token: args.token });
            const { start, end } = dateRange(7, args.tz);
            const data = await client.fetch(endpoint, start, end);
            console.log(JSON.stringify(data, null, 2));
          } catch (err) {
            handleError(err, args);
          }
        },
      }),
    },
  });
}
