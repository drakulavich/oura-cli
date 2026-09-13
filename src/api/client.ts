import { CliError, redactSecrets } from '../lib/errors.js';
import { resolveToken } from './token.js';
import type { OuraEndpoint } from './types.js';

const BASE_URL = 'https://api.ouraring.com/v2/usercollection';

/** For an error message: what a JSON value is, without printing it (bodies can be large or sensitive). */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
/** Pages of 1000 rows: ~35 heartrate pages per month, so this bounds a runaway `next_token` stream, not real data. */
const MAX_PAGES = 10_000;

/**
 * How many `429 Too Many Requests` answers one page absorbs before the command fails. A long
 * `fetch hr` is hundreds of sequential requests, and a single 429 used to end it with nothing to
 * show for the pages already fetched (#45).
 */
export const RETRY_LIMIT = 3;
/** The longest single wait, whatever `Retry-After` asks for: past a minute the user should decide. */
export const MAX_RETRY_AFTER_MS = 60_000;
const BACKOFF_MS = [1_000, 2_000, 4_000] as const;

/**
 * Milliseconds to wait before retry number `attempt` (0-based). `Retry-After` may be seconds or an
 * HTTP date; anything else, or nothing, falls back to a doubling backoff.
 */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  let ms = Number.NaN;
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - now;
  }
  if (!Number.isFinite(ms) || ms <= 0) ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export interface PageEvent {
  endpoint: OuraEndpoint;
  /** Rows on this page. */
  rows: number;
}

export interface OuraClientOptions {
  tokenPath?: string;
  token?: string;
  /** Called as each page arrives; `fetch` uses it to show progress on a terminal (#45). */
  onPage?: (page: PageEvent) => void;
  /** Waits before a retry. Injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export class OuraClient {
  private token: string;
  private onPage: ((page: PageEvent) => void) | undefined;
  private sleep: (ms: number) => Promise<void>;

  constructor(options: OuraClientOptions = {}) {
    this.onPage = options.onPage;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const { token, source } = resolveToken(options.token, options.tokenPath);
    if (!token) {
      throw new CliError('TOKEN_MISSING', `No Oura access token at ${source}.`, 'Run `oura-cli login` or set OURA_TOKEN.');
    }
    if (/\s/.test(token)) {
      // A multi-line token file would otherwise reach fetch() and come back as a header error quoting the token.
      throw new CliError('TOKEN_INVALID', `The token from ${source} contains whitespace or a line break; a token is a single line.`, 'Fix the file or variable, or run `oura-cli login` again.');
    }
    this.token = token;
  }

  /**
   * GET every page of `endpoint` for `query` and return the concatenated `data`.
   * Callers go through `fetchCollection()` in the collection registry, which builds the
   * query: heartrate takes `start_datetime`/`end_datetime` while the other endpoints take dates.
   */
  async fetch<T>(endpoint: OuraEndpoint, query: Record<string, string>): Promise<T[]> {
    const rows: T[] = [];
    const seenTokens = new Set<string>();
    let nextToken: string | null = null;
    do {
      if (seenTokens.size >= MAX_PAGES) {
        throw new CliError('API_ERROR', `Oura API returned more than ${MAX_PAGES} pages for ${endpoint}; stopping.`);
      }
      const params = new URLSearchParams(query);
      if (nextToken) params.set('next_token', nextToken);
      const page: { data: T[]; next_token: string | null } = await this.getPage(endpoint, `${BASE_URL}/${endpoint}?${params}`);
      this.onPage?.({ endpoint, rows: page.data.length });
      for (const row of page.data) rows.push(row);
      nextToken = page.next_token;
      if (nextToken && seenTokens.has(nextToken)) {
        throw new CliError('API_ERROR', `Oura API repeated pagination token for ${endpoint}; stopping to avoid a loop.`);
      }
      if (nextToken) seenTokens.add(nextToken);
    } while (nextToken);
    return rows;
  }

  private async getPage<T>(endpoint: OuraEndpoint, url: string): Promise<{ data: T[]; next_token: string | null }> {
    let response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    // The same page again after the wait the API asked for: a 429 is the API pacing us, not refusing us.
    for (let attempt = 0; response.status === 429 && attempt < RETRY_LIMIT; attempt++) {
      await response.body?.cancel(); // the 429 body is not read; release the stream rather than hold it to GC
      await this.sleep(retryDelayMs(response.headers.get('retry-after'), attempt));
      response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    }

    if (!response.ok) {
      const rawBody = await response.text();
      const redacted = redactSecrets(rawBody);
      const body = redacted.length > 200 ? redacted.slice(0, 200) + '… (truncated)' : redacted;
      if (response.status === 401 || response.status === 403) {
        throw new CliError('TOKEN_INVALID', `Oura API ${response.status}: ${body}`, 'Run `oura-cli login` with a fresh Personal Access Token, or check OURA_TOKEN.');
      }
      if (response.status === 429) {
        throw new CliError('API_ERROR', `Oura API 429: ${body}`, `Rate limited; the page was retried ${RETRY_LIMIT} times. Wait a few minutes and run the command again, or ask for a shorter range.`);
      }
      throw new CliError('API_ERROR', `Oura API ${response.status}: ${body}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new CliError('API_ERROR', 'Empty response body from Oura API.');
    }
    // The shape is Oura's promise, not ours. A body that is not an object, or carries something other
    // than an array under `data`, is an API fault and must not be walked as rows: a string there was
    // iterated per character and reported as dropped samples that never existed (#112).
    const body = json as { data?: unknown; next_token?: unknown } | null;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new CliError('API_ERROR', `Oura API returned a malformed body for ${endpoint}: expected an object, got ${kindOf(body)}.`);
    }
    if (body.data != null && !Array.isArray(body.data)) {
      throw new CliError('API_ERROR', `Oura API returned a malformed body for ${endpoint}: expected an array under "data", got ${kindOf(body.data)}.`);
    }
    // Same rule for the cursor: a non-string there is not "last page", it is a body we do not understand,
    // and treating it as the end would report a short, exit-0 sync with rows missing.
    if (body.next_token != null && typeof body.next_token !== 'string') {
      throw new CliError('API_ERROR', `Oura API returned a malformed body for ${endpoint}: expected a string or null under "next_token", got ${kindOf(body.next_token)}.`);
    }
    return { data: (body.data as T[] | null | undefined) ?? [], next_token: body.next_token ?? null };
  }
}
