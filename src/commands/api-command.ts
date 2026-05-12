import { Command } from 'commander';
import { getClient, todayDate, dateRange } from './helpers.js';
import type { OuraEndpoint } from '../api/types.js';

export function createApiCommand(name: string, description: string, endpoint: OuraEndpoint): Command {
  const cmd = new Command(name).description(description);

  cmd.command('today')
    .description(`Today's ${name} data`)
    .action(async (_, command) => {
      const opts = command.parent!.parent!.opts();
      const client = getClient(opts);
      const data = await client.fetch(endpoint, todayDate(), todayDate());
      console.log(JSON.stringify(data, null, 2));
    });

  cmd.command('date <day>')
    .description(`${name} data for specific date (YYYY-MM-DD)`)
    .action(async (day: string, _, command) => {
      const opts = command.parent!.parent!.opts();
      const client = getClient(opts);
      const data = await client.fetch(endpoint, day, day);
      console.log(JSON.stringify(data, null, 2));
    });

  cmd.command('week')
    .description(`Last 7 days of ${name} data`)
    .action(async (_, command) => {
      const opts = command.parent!.parent!.opts();
      const client = getClient(opts);
      const { start, end } = dateRange(7);
      const data = await client.fetch(endpoint, start, end);
      console.log(JSON.stringify(data, null, 2));
    });

  return cmd;
}
