import { CliError } from './errors.js';

const ANSI = /\u001b\[[0-9;]*m/g;

const FETCH_HINT = 'The per-collection commands were replaced in 0.5.0 by `oura-cli fetch <collection>`, e.g. `oura-cli fetch sleep --day 2026-09-01`. Run `oura-cli fetch --help`.';

/** Commands removed in 0.5.0, with where their job went. */
const REMOVED_COMMANDS: Record<string, string> = {
  reset: '`db reset` was removed in 0.5.0; delete the database file (`--db` / OURA_DB_PATH) and run `oura-cli sync` to rebuild it.',
  import: '`db import` was removed in 0.5.0; `oura-cli sync` downloads and stores everything.',
  sleep: FETCH_HINT, readiness: FETCH_HINT, activity: FETCH_HINT, hr: FETCH_HINT,
  spo2: FETCH_HINT, stress: FETCH_HINT, workout: FETCH_HINT,
};

/**
 * citty throws its own errors (with a `code`) before a command runs: unknown command,
 * missing positional, no command at all. Translate them into BAD_ARGS so they reach the
 * user through the same envelope as every other error; anything else passes through.
 */
export function fromCittyError(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return err;
  const message = (err instanceof Error ? err.message : String(err)).replace(ANSI, '');
  switch (code) {
    case 'E_UNKNOWN_COMMAND': {
      const name = message.replace(/^Unknown command\s*/, '').trim();
      const hint = Object.hasOwn(REMOVED_COMMANDS, name) ? REMOVED_COMMANDS[name] : 'Run `oura-cli --help` for the list of commands.';
      return new CliError('BAD_ARGS', `Unknown command "${name}".`, hint);
    }
    case 'EARG':
      return new CliError('BAD_ARGS', message.endsWith('.') ? message : `${message}.`, 'Run the command with --help to see its arguments.');
    case 'E_NO_COMMAND':
      return new CliError('BAD_ARGS', 'No command specified.', 'Run `oura-cli --help` for the list of commands.');
    default:
      return err;
  }
}
