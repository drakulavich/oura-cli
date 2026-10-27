import { CliError } from './errors.js';

/**
 * A value the user supplied but left blank is a mistake, not "use the default".
 *
 * Every resolver here reads an explicit flag, then an environment variable, then a fallback.
 * Testing that chain for truthiness reads `--db ""` — what a wrapper produces from an unset
 * variable — as "not given", and the command silently works on the default instead. For `--db`
 * that meant opening, migrating and writing the user's real cache (#76); for `--token` it means
 * authenticating as somebody else, and for `OURA_TZ` it means shifting every day boundary. An
 * unset variable still means the default; a present but blank one is refused.
 *
 * @param source how the value reached us, e.g. `--token` or `OURA_TZ`
 * @param fallback what omitting it would have selected, named for the hint
 */
export function requireValue(value: string, source: string, fallback: string): string {
  if (value.trim() === '') {
    throw new CliError('BAD_ARGS', `${source} has no value`, `Pass a value, or remove ${source} to fall back to ${fallback}.`);
  }
  return value;
}
