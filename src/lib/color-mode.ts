/**
 * Decides colour for the whole process, and must run before anything that reads it.
 *
 * chalk can be told at any time (`chalk.level = 0`), but citty picks its usage colours up from
 * `NO_COLOR` when its module is first evaluated, so setting the variable next to the chalk call
 * in `src/index.ts` was already too late and `--help --no-color` stayed coloured. This module
 * exists to be the first import in the entry point: ES modules evaluate in import order, so the
 * variable is set before citty is loaded.
 *
 * Piped output is plain for the same reason, unless the user asked for colour with FORCE_COLOR.
 */
import chalk from 'chalk';

export function resolveColorMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  const asked = argv.includes('--no-color') || Boolean(env.NO_COLOR);
  const pipedWithoutForce = process.stdout.isTTY !== true && !env.FORCE_COLOR;
  return asked || pipedWithoutForce;
}

if (resolveColorMode()) {
  process.env.NO_COLOR = '1';
  chalk.level = 0;
}
