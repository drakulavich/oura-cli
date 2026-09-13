import { CliError } from './errors.js';
import { GLOBAL_FLAGS_WITH_VALUE } from './argv-normalize.js';

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * A name citty could plausibly have been given as a command: lower-case, short, no separators.
 * The length bound is what keeps a lower-case secret out of the message; every real command name
 * in this CLI is under a dozen characters.
 */
const COMMAND_NAME = /^[a-z][a-z0-9-]{0,19}$/;

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * The global flag `token` was probably meant to be: one edit away from one, or a truncation of
 * one (`--tok` for `--token`, which is two edits but the commonest way to mistype it).
 *
 * Only consulted once citty has already failed, so a valid command line never reaches this and a
 * command's own flag (`sync --to`, one edit from `--tz`) cannot be mistaken for a near miss.
 */
function nearestGlobalFlag(token: string): string | undefined {
  if (!token.startsWith('--') || token.length < 4) return undefined;
  return [...GLOBAL_FLAGS_WITH_VALUE].find(flag =>
    flag !== token && (editDistanceAtMostOne(flag, token) || flag.startsWith(token)));
}

/** Commands that take a subcommand (`db`), each with the names it accepts. */
export type ParentCommands = Readonly<Record<string, readonly string[]>>;

/**
 * The tokens citty reads as command names, in order: not a flag, and not the value of a global
 * flag that takes one (`--db db` names a file, not the command).
 */
export function commandTokens(rawArgs: readonly string[]): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i]!;
    if (GLOBAL_FLAGS_WITH_VALUE.has(tok)) { i++; continue; }
    if (tok.startsWith('-')) continue;
    tokens.push(tok);
  }
  return tokens;
}

/**
 * citty throws its own errors (with a `code`) before a command runs: unknown command,
 * missing positional, no command at all. Translate them into BAD_ARGS so they reach the
 * user through the same envelope as every other error; anything else passes through.
 *
 * `removedCommandHints` maps a command name that no longer exists to the hint to show
 * instead of the generic --help pointer (see src/index.ts). `parents` names the commands
 * that take a subcommand, so `oura-cli db` and `oura-cli db toady` are pointed at
 * `oura-cli db --help` and its subcommand list rather than at the root help (#61).
 *
 * The unknown-command name is recovered from citty's message text ("Unknown command <name>",
 * with the name in cyan). The end-to-end cases in src/index.test.ts run the real citty, so a
 * wording change upstream fails there, not silently here.
 */
export function fromCittyError(
  err: unknown,
  removedCommandHints: Readonly<Record<string, string>> = {},
  rawArgs: readonly string[] = [],
  parents: ParentCommands = {},
): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return err;
  const message = (err instanceof Error ? err.message : String(err)).replace(ANSI, '');
  // hasOwn: a name like "constructor" must not read Object.prototype.
  const first = commandTokens(rawArgs)[0];
  const parent = first !== undefined && Object.hasOwn(parents, first) ? first : undefined;
  const parentHelp = parent === undefined ? undefined
    : `\`oura-cli ${parent}\` takes one of: ${parents[parent]!.join(', ')}. Run \`oura-cli ${parent} --help\` for details.`;
  switch (code) {
    case 'E_UNKNOWN_COMMAND': {
      const name = message.replace(/^Unknown command\s*/, '').trim();

      // A misspelled global flag leaves its value in the command position, so citty names the
      // value. Blame the flag instead: with `--tok <token>` the value is the user's token, and
      // an error message is the last place it should appear (#95).
      const before = rawArgs[rawArgs.lastIndexOf(name) - 1];
      const meant = before === undefined ? undefined : nearestGlobalFlag(before);
      if (meant) {
        return new CliError('BAD_ARGS', `Unknown flag "${before}".`, `Did you mean ${meant}? Its value was read as a command name.`);
      }

      // `oura-cli db --db x`: citty takes the first token after `db` that does not start with "-"
      // as its subcommand, so a global flag's value is reported as an unknown command. There was
      // no subcommand at all, and that is what the user needs to hear.
      if (parentHelp !== undefined && before !== undefined && GLOBAL_FLAGS_WITH_VALUE.has(before)) {
        return new CliError('BAD_ARGS', `"${parent}" needs a subcommand.`, parentHelp);
      }

      // Anything that cannot be a command name is not quoted back either: a path, a token, a
      // date. Naming it helps nobody and may put a secret in a log.
      if (!COMMAND_NAME.test(name)) {
        return new CliError('BAD_ARGS', 'Unknown command.', 'A value was read as a command name. Check the flags before it, and run `oura-cli --help` for the list of commands.');
      }

      const hint = Object.hasOwn(removedCommandHints, name)
        ? removedCommandHints[name]
        : parentHelp ?? 'Run `oura-cli --help` for the list of commands.';
      return new CliError('BAD_ARGS', `Unknown command "${name}".`, hint);
    }
    case 'EARG':
      return new CliError('BAD_ARGS', message.endsWith('.') ? message : `${message}.`, 'Run the command with --help to see its arguments.');
    case 'E_NO_COMMAND':
      return parentHelp === undefined
        ? new CliError('BAD_ARGS', 'No command specified.', 'Run `oura-cli --help` for the list of commands.')
        : new CliError('BAD_ARGS', `"${parent}" needs a subcommand.`, parentHelp);
    default:
      return err;
  }
}
