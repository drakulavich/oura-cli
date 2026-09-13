// First: sets NO_COLOR before citty is evaluated, which is when it decides its usage colours.
import './lib/apply-color-mode.js';
import { readFileSync } from 'fs';
import { defineCommand, runCommand, runMain } from 'citty';
import { buildRegistry } from './commands/registry.js';
import { commonArgs } from './commands/common.js';
import { isVersionRequest, normalizeArgv } from './lib/argv-normalize.js';
import { commandTokens, fromCittyError, type ParentCommands } from './lib/citty-error.js';
import { emitError, exitCodeFor } from './lib/errors.js';
import { formatFromArgv } from './lib/format-resolve.js';

const VERSION = (JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }).version;

const subCommands = buildRegistry(VERSION);

/** Commands with subcommands (`db`), so `oura-cli db` and `oura-cli db toady` point at `db --help` (#61). */
const PARENT_COMMANDS: ParentCommands = Object.fromEntries(
  Object.entries(subCommands).flatMap(([name, def]) => {
    const subs = (def as { subCommands?: unknown }).subCommands;
    return subs !== null && typeof subs === 'object' ? [[name, Object.keys(subs)]] : [];
  }),
);

const FETCH_HINT = 'The per-collection commands were replaced in 0.5.0 by `oura-cli fetch <collection>`, e.g. `oura-cli fetch sleep --day 2026-09-01`. Run `oura-cli fetch --help`.';

/** Commands removed in 0.5.0 and where their job went; shown when someone still types them. */
const REMOVED_COMMANDS: Readonly<Record<string, string>> = {
  reset: '`db reset` was removed in 0.5.0; delete the database file (`--db` / OURA_DB_PATH) and run `oura-cli sync` to rebuild it.',
  import: '`db import` was removed in 0.5.0; `oura-cli sync` downloads and stores everything.',
  sleep: FETCH_HINT, readiness: FETCH_HINT, activity: FETCH_HINT, hr: FETCH_HINT,
  spo2: FETCH_HINT, stress: FETCH_HINT, workout: FETCH_HINT,
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

const rawArgs = normalizeArgv(process.argv).slice(2);
// A bare `oura-cli` on a terminal shows the root help; a bare `oura-cli db` shows db's, for the
// same reason, whatever global flags sit around it. On a pipe both are BAD_ARGS, since an agent
// wants the envelope, not usage text.
const commands = commandTokens(rawArgs);
const bareParent = commands.length === 1 && Object.hasOwn(PARENT_COMMANDS, commands[0]!);
const wantsHelp = rawArgs.some(a => a === '--help' || a === '-h')
  || ((commands.length === 0 || bareParent) && process.stdout.isTTY === true);

if (isVersionRequest(rawArgs)) {
  // citty only answers --version when it is the sole argument; `oura-cli --db x --version` should work too.
  console.log(VERSION);
} else if (wantsHelp) {
  // citty renders usage itself.
  runMain(main, { rawArgs: bareParent ? [...rawArgs, '--help'] : rawArgs });
} else {
  // Everything else: errors citty raises before a command runs (unknown command, missing
  // positional) get the same envelope and exit code as errors raised inside a command,
  // instead of citty's coloured usage dump on stdout.
  runCommand(main, { rawArgs }).catch((raw: unknown) => {
    const err = fromCittyError(raw, REMOVED_COMMANDS, rawArgs, PARENT_COMMANDS);
    emitError(err, formatFromArgv(rawArgs, process.stdout.isTTY === true));
    process.exit(exitCodeFor(err));
  });
}
