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
/**
 * The most one command waits on 429 answers in total. The per-page limit alone let a 77-page
 * `fetch hr` sleep for hours, one bounded wait at a time; past this the command fails and says so.
 */
export const MAX_TOTAL_WAIT_MS = 3 * 60_000;
const BACKOFF_MS = [1_000, 2_000, 4_000] as const;

/**
 * Milliseconds to wait before retry number `attempt` (0-based). `Retry-After` may be seconds or an
 * HTTP date; anything else, or nothing, falls back to a doubling backoff. Two headers arrive joined
 * as "5, 10"; the first is the one to honour.
 */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  let ms = Number.NaN;
  if (retryAfter !== null) {
    // Two headers arrive joined with a comma, and an HTTP date carries commas of its own
    // ("Sun, 13 Sep 2026 10:00:30 GMT"), so the readings are: the whole value, the first HTTP date
    // in it, and the first comma-separated part. Seconds first, then dates.
    const whole = retryAfter.trim();
    const firstPart = whole.split(',')[0]!.trim();
    const firstDate = whole.match(/^[A-Za-z]{3}, [^,]*? GMT/)?.[0] ?? '';
    const seconds = [whole, firstPart].filter(r => r !== '').map(Number).find(Number.isFinite);
    const date = [whole, firstDate, firstPart].map(Date.parse).find(Number.isFinite);
    if (seconds !== undefined) ms = seconds * 1_000;
    else if (date !== undefined) ms = date - now;
  }
  if (!Number.isFinite(ms) || ms <= 0) ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export interface PageEvent {
  endpoint: OuraEndpoint;
  /** Rows on this page. */
  rows: number;
}

export interface RetryEvent {
  endpoint: OuraEndpoint;
  /** How long the client is about to wait before asking for the page again. */
  waitMs: number;
  /** 0 for the first retry of this page. */
  attempt: number;
}

export interface OuraClientOptions {
  tokenPath?: string;
  token?: string;
  /** Called as each page arrives; `fetch` and `sync` use it to show progress on a terminal (#45). */
  onPage?: (page: PageEvent) => void;
  /** Called before each wait on a 429, so the wait is not silence indistinguishable from a hang. */
  onRetry?: (retry: RetryEvent) => void;
  /** Waits before a retry. Injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export class OuraClient {
  private token: string;
  private onPage: ((page: PageEvent) => void) | undefined;
  private onRetry: ((retry: RetryEvent) => void) | undefined;
  private sleep: (ms: number) => Promise<void>;
  /** Milliseconds this client has spent waiting on 429 answers; bounded by MAX_TOTAL_WAIT_MS. */
  private waitedMs = 0;

  constructor(options: OuraClientOptions = {}) {
    this.onPage = options.onPage;
    this.onRetry = options.onRetry;
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

  /** One GET with the token; a transport failure (DNS, refused, reset) becomes an API_ERROR with a hint, not an UNKNOWN. */
  private async request(url: string): Promise<Response> {
    try {
      return await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CliError('API_ERROR', `Could not reach the Oura API: ${msg}`, 'Check the network connection and try again.');
    }
  }

  private async getPage<T>(endpoint: OuraEndpoint, url: string): Promise<{ data: T[]; next_token: string | null }> {
    let response = await this.request(url);
    // The same page again after the wait the API asked for: a 429 is the API pacing us, not refusing
    // us. Bounded twice: RETRY_LIMIT waits per page, MAX_TOTAL_WAIT_MS of waiting per command.
    let retries = 0;
    for (; response.status === 429 && retries < RETRY_LIMIT; retries++) {
      const waitMs = retryDelayMs(response.headers.get('retry-after'), retries);
      if (this.waitedMs + waitMs > MAX_TOTAL_WAIT_MS) break;
      await response.body?.cancel(); // the 429 body is not read; release the stream rather than hold it to GC
      this.waitedMs += waitMs;
      this.onRetry?.({ endpoint, waitMs, attempt: retries });
      await this.sleep(waitMs);
      response = await this.request(url);
    }

    if (!response.ok) {
      const rawBody = await response.text();
      // The body is the API's text, and it has quoted the request back before: the literal token goes too.
      const redacted = redactSecrets(rawBody).split(this.token).join('[REDACTED]');
      const body = redacted.length > 200 ? redacted.slice(0, 200) + '… (truncated)' : redacted;
      if (response.status === 401 || response.status === 403) {
        throw new CliError('TOKEN_INVALID', `Oura API ${response.status}: ${body}`, 'Run `oura-cli login` with a fresh Personal Access Token, or check OURA_TOKEN.');
      }
      if (response.status === 429) {
        const waited = Math.round(this.waitedMs / 1_000);
        throw new CliError('API_ERROR', `Oura API 429: ${body}`,
          `Rate limited; this page was retried ${retries} time${retries === 1 ? '' : 's'} and the command has waited ${waited} s on 429 answers (the most it will is ${MAX_TOTAL_WAIT_MS / 1_000} s). Wait a few minutes and run it again, or ask for a shorter range.`);
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
