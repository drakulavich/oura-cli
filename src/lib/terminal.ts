/** Width to lay text out in: the terminal's when stdout is one, else the conventional 80. */
export function terminalWidth(): number {
  return screenWidth() ?? 80;
}

/** The terminal's width when `stream` (stdout unless told otherwise) is one; undefined on a pipe, where nothing wraps. */
export function screenWidth(stream: NodeJS.WriteStream = process.stdout): number | undefined {
  return stream.isTTY && stream.columns ? stream.columns : undefined;
}
