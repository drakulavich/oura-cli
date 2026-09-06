/**
 * Decides colour for the whole process. The decision has to be applied before anything that
 * reads it: chalk can be told at any time (`chalk.level = 0`), but citty picks its usage colours
 * up from `NO_COLOR` when its module is first evaluated, so setting the variable in the entry
 * point's body was already too late and `--help --no-color` stayed coloured. `apply-color-mode.ts`
 * is the side-effecting module the entry point imports first; this one stays pure so it can be
 * tested without touching the environment.
 */

/** Just the variables that matter, so `process.env` and a test literal both fit. */
export type ColorEnv = Readonly<Record<string, string | undefined>>;

/** chalk reads `FORCE_COLOR=0` and `FORCE_COLOR=false` as "off"; anything else asks for colour. */
function forcesColor(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** True when colour must be off: the user said so, or output is piped and nothing forces it. */
export function shouldDisableColor(argv: readonly string[], env: ColorEnv, isTty: boolean): boolean {
  if (argv.includes('--no-color') || env.NO_COLOR) return true;
  return !isTty && !forcesColor(env.FORCE_COLOR);
}
