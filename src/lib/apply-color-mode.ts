import chalk from 'chalk';
import { shouldDisableColor } from './color-mode.js';

// Side effect at module scope, on purpose: the entry point imports this first so NO_COLOR is set
// before citty is evaluated, which is when citty decides whether to colour its usage output.
if (shouldDisableColor(process.argv, process.env, process.stdout.isTTY === true)) {
  process.env.NO_COLOR = '1';
  chalk.level = 0;
}
