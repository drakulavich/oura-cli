import { CliError, redactSecrets } from '../lib/errors.js';
import { resolveToken } from './token.js';
import type { OuraEndpoint } from './types.js';

const BASE_URL = 'https://api.ouraring.com/v2/usercollection';

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
    this.token = token;
  }

  /**
   * GET every page of `endpoint` for `query` and return the concatenated `data`.
   * Callers build the query with `rangeQuery()` from the collection registry, because
   * heartrate takes `start_datetime`/`end_datetime` while the other endpoints take dates.
   */
  async fetch<T>(endpoint: OuraEndpoint, query: Record<string, string>): Promise<T[]> {
    const rows: T[] = [];
    const seenTokens = new Set<string>();
    let nextToken: string | null = null;
    do {
      const params = new URLSearchParams(query);
      if (nextToken) params.set('next_token', nextToken);
      const page: { data: T[]; next_token: string | null } = await this.getPage(`${BASE_URL}/${endpoint}?${params}`);
      rows.push(...page.data);
      nextToken = page.next_token;
      if (nextToken && seenTokens.has(nextToken)) {
        throw new CliError('API_ERROR', `Oura API repeated pagination token for ${endpoint}; stopping to avoid a loop.`);
      }
      if (nextToken) seenTokens.add(nextToken);
    } while (nextToken);
    return rows;
  }

  private async getPage<T>(url: string): Promise<{ data: T[]; next_token: string | null }> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!response.ok) {
      const rawBody = await response.text();
      const redacted = redactSecrets(rawBody);
      const body = redacted.length > 200 ? redacted.slice(0, 200) + '… (truncated)' : redacted;
      if (response.status === 401 || response.status === 403) {
        throw new CliError('TOKEN_INVALID', `Oura API ${response.status}: ${body}`);
      }
      throw new CliError('API_ERROR', `Oura API ${response.status}: ${body}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new CliError('API_ERROR', 'Empty response body from Oura API.');
    }
    const body = json as { data?: T[]; next_token?: string | null };
    return { data: body.data ?? [], next_token: body.next_token ?? null };
  }
}
