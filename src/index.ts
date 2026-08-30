import chalk from 'chalk';
import { defineCommand, runMain } from 'citty';
import { loginCommand } from './commands/login.js';
import { describeCommand } from './commands/describe.js';
import { syncCommand } from './commands/sync.js';
import { dbCommand } from './commands/db.js';
import { reportCommand } from './commands/report.js';
import { healthcheckCommand } from './commands/healthcheck.js';
import { doctorCommand } from './commands/doctor.js';
import { manifestCommand } from './commands/manifest.js';
import { createApiCommand } from './commands/api-command.js';
import { commonArgs } from './commands/common.js';
import { normalizeArgv } from './lib/argv-normalize.js';

const VERSION = '0.4.5';

// Apply --no-color / NO_COLOR early, before any chalk usage in this process.
if (process.argv.includes('--no-color') || process.env.NO_COLOR) {
  chalk.level = 0;
}

const main = defineCommand({
  meta: {
    name: 'oura-cli',
    version: VERSION,
    description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
  },
  args: { ...commonArgs },
  subCommands: {
    login:       loginCommand,
    describe:    describeCommand(VERSION),
    healthcheck: healthcheckCommand(VERSION),
    doctor:      doctorCommand,
    manifest:    manifestCommand(VERSION),
    sleep:       createApiCommand('sleep',     'Fetch daily sleep scores from Oura API.',      'daily_sleep'),
    readiness:   createApiCommand('readiness', 'Fetch daily readiness scores from Oura API.',  'daily_readiness'),
    activity:    createApiCommand('activity',  'Fetch daily activity scores from Oura API.',   'daily_activity'),
    hr:          createApiCommand('hr',        'Fetch heart rate samples from Oura API.',       'heartrate'),
    spo2:        createApiCommand('spo2',      'Fetch blood oxygen (SpO2) data from Oura API.', 'daily_spo2'),
    stress:      createApiCommand('stress',    'Fetch daily stress data from Oura API.',        'daily_stress'),
    workout:     createApiCommand('workout',   'Fetch workout data from Oura API.',             'workout'),
    sync:        syncCommand,
    db:          dbCommand,
    report:      reportCommand,
  },
});

const normalized = normalizeArgv(process.argv);
runMain(main, { rawArgs: normalized.slice(2) });
