import { Command } from 'commander';
import { createApiCommand } from './commands/api-command.js';
import { dbCommand } from './commands/db.js';
import { syncCommand } from './commands/sync.js';
import { reportCommand } from './commands/report.js';
import { loginCommand } from './commands/login.js';
import { describeCommand } from './commands/describe.js';
import { emitError, exitCodeFor } from './lib/errors.js';
import { resolveFormat } from './lib/format-resolve.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('oura-cli')
  .description('Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.')
  .version(VERSION)
  .option('--format <format>', 'Output format: table | json (default auto-detect by TTY)')
  .option('--token <pat>', 'Inline access token (prefer env vars or `oura-cli login`)')
  .option('--db <path>', 'Path to SQLite database file (env: OURA_DB_PATH)')
  .option('--tz <timezone>', 'Display timezone (env: OURA_TZ; default auto-detect)');

program.addCommand(loginCommand());
program.addCommand(describeCommand(VERSION));
program.addCommand(createApiCommand('sleep',     'Fetch daily sleep scores from Oura API.',      'daily_sleep'));
program.addCommand(createApiCommand('readiness', 'Fetch daily readiness scores from Oura API.',  'daily_readiness'));
program.addCommand(createApiCommand('activity',  'Fetch daily activity scores from Oura API.',   'daily_activity'));
program.addCommand(createApiCommand('hr',        'Fetch heart rate samples from Oura API.',       'heartrate'));
program.addCommand(createApiCommand('spo2',      'Fetch blood oxygen (SpO2) data from Oura API.', 'daily_spo2'));
program.addCommand(createApiCommand('stress',    'Fetch daily stress data from Oura API.',        'daily_stress'));
program.addCommand(createApiCommand('workout',   'Fetch workout data from Oura API.',             'workout'));
program.addCommand(syncCommand());
program.addCommand(dbCommand());
program.addCommand(reportCommand());

program.parseAsync(process.argv).catch((err) => {
  const fmt = resolveFormat({
    explicit: program.opts().format,
    isTty: process.stdout.isTTY === true,
  });
  emitError(err, fmt);
  process.exit(exitCodeFor(err));
});
