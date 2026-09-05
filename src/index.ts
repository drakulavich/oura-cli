import chalk from 'chalk';
import { defineCommand, runMain } from 'citty';
import type { SubCommandsDef } from 'citty';
import { loginCommand } from './commands/login.js';
import { describeCommand } from './commands/describe.js';
import { syncCommand } from './commands/sync.js';
import { dbCommand } from './commands/db.js';
import { reportCommand } from './commands/report.js';
import { healthcheckCommand } from './commands/healthcheck.js';
import { doctorCommand } from './commands/doctor.js';
import { manifestCommand } from './commands/manifest.js';
import { fetchCommand } from './commands/fetch.js';
import { commonArgs } from './commands/common.js';
import { normalizeArgv } from './lib/argv-normalize.js';

const VERSION = '0.4.5';

// Apply --no-color / NO_COLOR early, before any chalk usage in this process.
if (process.argv.includes('--no-color') || process.env.NO_COLOR) {
  chalk.level = 0;
}

const subCommands: SubCommandsDef = {
  login:       loginCommand,
  describe:    describeCommand(VERSION, () => subCommands),
  healthcheck: healthcheckCommand(VERSION),
  doctor:      doctorCommand,
  manifest:    manifestCommand(VERSION, () => subCommands),
  fetch:       fetchCommand,
  sync:        syncCommand,
  db:          dbCommand,
  report:      reportCommand,
};

const main = defineCommand({
  meta: {
    name: 'oura-cli',
    version: VERSION,
    description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
  },
  args: { ...commonArgs },
  subCommands,
});

const normalized = normalizeArgv(process.argv);
runMain(main, { rawArgs: normalized.slice(2) });
