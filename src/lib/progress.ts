/** Where a progress line goes: `process.stderr`, or a recorder in tests. */
export interface ProgressSink {
  write(chunk: string): unknown;
}

export interface PageProgress {
  /** A page of `endpoint` arrived with `rows` rows. Counters restart when the endpoint changes. */
  onPage: (page: { endpoint: string; rows: number }) => void;
  /** The client is about to wait `waitMs` on a 429 before asking for the same page again. */
  onRetry: (retry: { endpoint: string; waitMs: number }) => void;
  /** Wipe the line; nothing of it stays in the scrollback. */
  done: () => void;
}

/**
 * One progress line for a long paginated fetch, rewritten in place with `\r` and wiped by `done()`.
 * A 61-day `fetch hr` is 77 pages and over a minute of silence in JSON mode, indistinguishable from
 * a hang; a 429 wait is the same silence, so the line also says when the client is waiting (#45).
 *
 * For a terminal only: on a pipe, stderr carries the one-line error envelope and must stay clean,
 * so the caller decides from `process.stderr.isTTY` whether to build one at all.
 */
export function pageProgress(sink: ProgressSink, verb: string): PageProgress {
  let endpoint: string | undefined;
  let pages = 0;
  let rows = 0;
  let widest = 0;
  let written = false;

  const show = (text: string) => {
    widest = Math.max(widest, text.length);
    written = true;
    sink.write(`\r${text}`);
  };
  const status = () => (pages === 0 ? `  ${verb} ${endpoint}` : `  ${verb} ${endpoint}: page ${pages}, ${rows} rows so far`);

  return {
    onPage(page) {
      if (page.endpoint !== endpoint) { endpoint = page.endpoint; pages = 0; rows = 0; }
      pages++;
      rows += page.rows;
      show(`${status()}…`);
    },
    onRetry(retry) {
      if (retry.endpoint !== endpoint) { endpoint = retry.endpoint; pages = 0; rows = 0; }
      show(`${status()}; rate limited, retrying in ${Math.ceil(retry.waitMs / 1_000)} s…`);
    },
    done() {
      if (written) sink.write(`\r${' '.repeat(widest)}\r`);
    },
  };
}
