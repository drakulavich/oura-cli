/** Width to lay text out in: the terminal's when stdout is one, else the conventional 80. */
export function terminalWidth(): number {
  return screenWidth() ?? 80;
}

/** The terminal's width when stdout is one; undefined on a pipe, where nothing wraps. */
export function screenWidth(): number | undefined {
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : undefined;
}
