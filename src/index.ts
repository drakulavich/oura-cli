import { readFileSync } from 'fs';
import chalk from 'chalk';
import { defineCommand, runCommand, runMain } from 'citty';
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
import { isVersionRequest, normalizeArgv } from './lib/argv-normalize.js';
import { fromCittyError } from './lib/citty-error.js';
import { emitError, exitCodeFor } from './lib/errors.js';
import { formatFromArgv } from './lib/format-resolve.js';

const VERSION = (JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }).version;

// Apply --no-color / NO_COLOR early, before any chalk usage in this process.
if (process.argv.includes('--no-color') || process.env.NO_COLOR) {
  chalk.level = 0;
}

// Null prototype: otherwise `oura-cli constructor` resolves to Object.prototype.constructor and exits 0 silently.
const subCommands: SubCommandsDef = Object.assign(Object.create(null) as SubCommandsDef, {
  login:       loginCommand,
  describe:    describeCommand(VERSION, () => subCommands),
  healthcheck: healthcheckCommand(VERSION),
  doctor:      doctorCommand,
  manifest:    manifestCommand(VERSION, () => subCommands),
  fetch:       fetchCommand,
  sync:        syncCommand,
  db:          dbCommand,
  report:      reportCommand,
});

const main = defineCommand({
  meta: {
    name: 'oura-cli',
    version: VERSION,
    description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
  },
  args: { ...commonArgs },
  subCommands,
});

const rawArgs = normalizeArgv(process.argv).slice(2);
const wantsHelp = rawArgs.some(a => a === '--help' || a === '-h')
  || (rawArgs.length === 0 && process.stdout.isTTY === true);

if (isVersionRequest(rawArgs)) {
  // citty only answers --version when it is the sole argument; `oura-cli --db x --version` should work too.
  console.log(VERSION);
} else if (wantsHelp) {
  // citty renders usage itself.
  runMain(main, { rawArgs });
} else {
  // Everything else: errors citty raises before a command runs (unknown command, missing
  // positional) get the same envelope and exit code as errors raised inside a command,
  // instead of citty's coloured usage dump on stdout.
  runCommand(main, { rawArgs }).catch((raw: unknown) => {
    const err = fromCittyError(raw);
    emitError(err, formatFromArgv(rawArgs, process.stdout.isTTY === true));
    process.exit(exitCodeFor(err));
  });
}
