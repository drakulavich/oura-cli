import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OuraClient } from './client.js';
import { CliError } from '../lib/errors.js';

const realFetch = globalThis.fetch;

function mockFetch(response: { status: number; body: string }) {
  globalThis.fetch = (async () =>
    new Response(response.body, { status: response.status, statusText: 'mocked' })) as unknown as typeof globalThis.fetch;
}

describe('OuraClient.fetch error paths', () => {
  beforeEach(() => {
    process.env.OURA_TOKEN = 'test-token';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OURA_TOKEN;
  });

  it('throws TOKEN_INVALID on 401', async () => {
    mockFetch({ status: 401, body: '{"detail":"Invalid token"}' });
    const client = new OuraClient();
    const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('TOKEN_INVALID');
  });

  it('throws TOKEN_INVALID on 403', async () => {
    mockFetch({ status: 403, body: 'forbidden' });
    const client = new OuraClient();
    const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('TOKEN_INVALID');
  });

  it('throws API_ERROR on 429 rate limit', async () => {
    mockFetch({ status: 429, body: 'rate limited' });
    const client = new OuraClient();
    const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('API_ERROR');
  });

  it('throws API_ERROR on 500', async () => {
    mockFetch({ status: 500, body: 'oops' });
    const client = new OuraClient();
    const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('API_ERROR');
  });

  it('handles empty body 200 (the "Unexpected EOF" case from prod)', async () => {
    mockFetch({ status: 200, body: '' });
    const client = new OuraClient();
    const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('API_ERROR');
    expect((err as CliError).message).toContain('Empty response body');
  });

  it('redacts Bearer tokens from error messages', async () => {
    mockFetch({ status: 500, body: 'leaked Bearer abc123def456ghi789' });
    const client = new OuraClient();
    const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).not.toContain('abc123def456ghi789');
    expect((err as CliError).message).toContain('[REDACTED]');
  });
});
