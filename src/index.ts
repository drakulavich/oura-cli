import { Command } from 'commander';
import chalk from 'chalk';
import { createApiCommand } from './commands/api-command.js';
import { dbCommand } from './commands/db.js';
import { syncCommand } from './commands/sync.js';
import { reportCommand } from './commands/report.js';
import { loginCommand } from './commands/login.js';
import { describeCommand } from './commands/describe.js';
import { emitError, exitCodeFor } from './lib/errors.js';
import { resolveFormat } from './lib/format-resolve.js';
import { openDatabase, ensureSchema } from './db/database.js';

const VERSION = '0.2.1';

// Apply --no-color / NO_COLOR early, before any chalk usage in this process.
if (process.argv.includes('--no-color') || process.env.NO_COLOR) {
  chalk.level = 0;
}

const program = new Command();

program
  .name('oura-cli')
  .description('Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.')
  .version(VERSION)
  .option('--format <format>', 'Output format: table | json (default auto-detect by TTY)')
  .option('--token <pat>', 'Inline access token (prefer env vars or `oura-cli login`)')
  .option('--db <path>', 'Path to SQLite database file (env: OURA_DB_PATH)')
  .option('--tz <timezone>', 'Display timezone (env: OURA_TZ; default auto-detect)')
  .option('--no-color', 'Disable ANSI colors in human output (also honors NO_COLOR env)');

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

program
  .command('healthcheck')
  .description('Quick local DB health probe (JSON: {ok, version, latencyMs}).')
  .action(() => {
    const start = Date.now();
    const globalOpts = program.opts();
    let ok = true;
    let error: string | undefined;
    try {
      const db = openDatabase({ dbPath: globalOpts.db });
      ensureSchema(db);
      db.query('SELECT 1').get();
      db.close();
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
    console.log(JSON.stringify({ ok, version: VERSION, latencyMs: Date.now() - start, ...(error ? { error } : {}) }));
  });

program
  .command('manifest')
  .description('Print openclaw-tool-registry-compatible manifest as JSON.')
  .action(() => {
    console.log(JSON.stringify({
      id: 'oura-cli',
      version: VERSION,
      runtime: 'bun',
      bin: 'oura-cli',
      description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
      commands: [
        { name: 'login',       description: 'Save an Oura Personal Access Token.',           examples: ['oura-cli login'] },
        { name: 'describe',    description: 'Emit a machine-readable manifest of commands.', examples: ['oura-cli describe'] },
        { name: 'sleep',       description: 'Fetch daily sleep scores from Oura API.',       examples: ['oura-cli sleep --start 2026-05-01'] },
        { name: 'readiness',   description: 'Fetch daily readiness scores from Oura API.',   examples: ['oura-cli readiness --start 2026-05-01'] },
        { name: 'activity',    description: 'Fetch daily activity scores from Oura API.',    examples: ['oura-cli activity --start 2026-05-01'] },
        { name: 'hr',          description: 'Fetch heart rate samples from Oura API.',       examples: ['oura-cli hr --start 2026-05-01'] },
        { name: 'spo2',        description: 'Fetch blood oxygen (SpO2) data from Oura API.', examples: ['oura-cli spo2 --start 2026-05-01'] },
        { name: 'stress',      description: 'Fetch daily stress data from Oura API.',        examples: ['oura-cli stress --start 2026-05-01'] },
        { name: 'workout',     description: 'Fetch workout data from Oura API.',             examples: ['oura-cli workout --start 2026-05-01'] },
        { name: 'sync',        description: 'Sync all Oura collections into the local DB.',  examples: ['oura-cli sync'] },
        { name: 'db',          description: 'Query the local SQLite cache.',                 examples: ['oura-cli db today'] },
        { name: 'report',      description: 'Render a weekly or monthly summary report.',    examples: ['oura-cli report weekly'] },
        { name: 'healthcheck', description: 'Quick local DB health probe.',                  examples: ['oura-cli healthcheck'] },
        { name: 'manifest',    description: 'Print openclaw-tool-registry-compatible manifest as JSON.', examples: ['oura-cli manifest'] },
      ],
      envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH', 'OURA_DB_PATH', 'OURA_TZ'],
      healthcheck: { command: 'healthcheck', expects: { ok: 'boolean', version: 'string', latencyMs: 'number' } },
    }, null, 2));
  });

program.parseAsync(process.argv).catch((err) => {
  const fmt = resolveFormat({
    explicit: program.opts().format,
    isTty: process.stdout.isTTY === true,
  });
  emitError(err, fmt);
  process.exit(exitCodeFor(err));
});
