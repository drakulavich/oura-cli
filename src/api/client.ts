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

export interface OuraClientOptions {
  tokenPath?: string;
  token?: string;
}

export class OuraClient {
  private token: string;

  constructor(options: OuraClientOptions = {}) {
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
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!response.ok) {
      const rawBody = await response.text();
      const redacted = redactSecrets(rawBody);
      const body = redacted.length > 200 ? redacted.slice(0, 200) + '… (truncated)' : redacted;
      if (response.status === 401 || response.status === 403) {
        throw new CliError('TOKEN_INVALID', `Oura API ${response.status}: ${body}`, 'Run `oura-cli login` with a fresh Personal Access Token, or check OURA_TOKEN.');
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
    return { data: (body.data as T[] | null | undefined) ?? [], next_token: typeof body.next_token === 'string' ? body.next_token : null };
  }
}
