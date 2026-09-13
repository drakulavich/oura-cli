/** Where a progress line goes: `process.stderr`, or a recorder in tests. */
export interface ProgressSink {
  write(chunk: string): unknown;
}

/**
 * One progress line for a long paginated fetch, rewritten in place with `\r` and wiped by `done()`
 * so nothing of it remains in the scrollback. A 61-day `fetch hr` is 77 pages and over a minute of
 * silence in JSON mode, indistinguishable from a hang (#45).
 *
 * For a terminal only: on a pipe, stderr carries the one-line error envelope and must stay clean,
 * so the caller decides from `process.stderr.isTTY` whether to build one at all.
 */
export function pageProgress(sink: ProgressSink, label: string): { onPage: (page: { rows: number }) => void; done: () => void } {
  let pages = 0;
  let rows = 0;
  let widest = 0;
  return {
    onPage(page) {
      pages++;
      rows += page.rows;
      const line = `  ${label}: page ${pages}, ${rows} rows so far…`;
      widest = Math.max(widest, line.length);
      sink.write(`\r${line}`);
    },
    done() {
      if (pages > 0) sink.write(`\r${' '.repeat(widest)}\r`);
    },
  };
}
