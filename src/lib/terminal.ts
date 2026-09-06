/** Width to lay text out in: the terminal's when stdout is one, else the conventional 80. */
export function terminalWidth(): number {
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80;
}
