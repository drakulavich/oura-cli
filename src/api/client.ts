import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { CliError, redactSecrets } from '../lib/errors.js';
import type { OuraEndpoint } from './types.js';

const BASE_URL = 'https://api.ouraring.com/v2/usercollection';

export interface OuraClientOptions {
  tokenPath?: string;
  token?: string;
}

export class OuraClient {
  private token: string;

  constructor(options: OuraClientOptions = {}) {
    const direct = options.token ?? process.env.OURA_TOKEN;
    if (direct) {
      this.token = direct.trim();
    } else {
      const tokenPath = options.tokenPath
        ?? process.env.OURA_TOKEN_PATH
        ?? resolve(homedir(), '.oura-token');
      try {
        this.token = readFileSync(tokenPath, 'utf-8').trim();
      } catch {
        throw new CliError(
          'TOKEN_MISSING',
          `No Oura access token at ${tokenPath}.`,
          'Run `oura-cli login` or set OURA_TOKEN.',
        );
      }
    }
  }

  async fetch<T>(endpoint: OuraEndpoint, startDate: string, endDate?: string): Promise<T[]> {
    const params = new URLSearchParams({ start_date: startDate });
    if (endDate) params.set('end_date', endDate);

    const url = `${BASE_URL}/${endpoint}?${params}`;
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

    const json = await response.json();
    return (json as { data: T[] }).data ?? [];
  }
}
