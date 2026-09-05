import { CliError } from './errors.js';

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * citty throws its own errors (with a `code`) before a command runs: unknown command,
 * missing positional, no command at all. Translate them into BAD_ARGS so they reach the
 * user through the same envelope as every other error; anything else passes through.
 *
 * `removedCommandHints` maps a command name that no longer exists to the hint to show
 * instead of the generic --help pointer (see src/index.ts).
 *
 * The unknown-command name is recovered from citty's message text ("Unknown command <name>",
 * with the name in cyan). The end-to-end cases in src/index.test.ts run the real citty, so a
 * wording change upstream fails there, not silently here.
 */
export function fromCittyError(err: unknown, removedCommandHints: Readonly<Record<string, string>> = {}): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return err;
  const message = (err instanceof Error ? err.message : String(err)).replace(ANSI, '');
  switch (code) {
    case 'E_UNKNOWN_COMMAND': {
      const name = message.replace(/^Unknown command\s*/, '').trim();
      // hasOwn: a name like "constructor" must not read Object.prototype.
      const hint = Object.hasOwn(removedCommandHints, name)
        ? removedCommandHints[name]
        : 'Run `oura-cli --help` for the list of commands.';
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
