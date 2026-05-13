import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OuraClient } from './client.js';
import { CliError } from '../lib/errors.js';

const realFetch = globalThis.fetch;

function mockFetch(response: { status: number; body: string }) {
  globalThis.fetch = (async () =>
    new Response(response.body, { status: response.status, statusText: 'mocked' })) as unknown as typeof globalThis.fetch;
}

function captureRequestHeaders(): Promise<Headers> {
  return new Promise(resolve => {
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      resolve(new Headers(init.headers as HeadersInit));
      return new Response('{"data":[]}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;
  });
}

describe('OuraClient', () => {
  describe('auth resolution', () => {
    describe('when constructed with an inline token', () => {
      it('uses the token verbatim when fetching', async () => {
        const headerPromise = captureRequestHeaders();
        const client = new OuraClient({ token: 'inline-pat-abc' });
        await client.fetch('daily_sleep', '2026-05-10');
        const headers = await headerPromise;
        expect(headers.get('Authorization')).toBe('Bearer inline-pat-abc');
      });

      it('trims surrounding whitespace from the inline value', async () => {
        const headerPromise = captureRequestHeaders();
        const client = new OuraClient({ token: '  padded-token  ' });
        await client.fetch('daily_sleep', '2026-05-10');
        const headers = await headerPromise;
        expect(headers.get('Authorization')).toBe('Bearer padded-token');
      });
    });

    describe('when OURA_TOKEN env is set', () => {
      beforeEach(() => { process.env.OURA_TOKEN = 'env-token-xyz'; });
      afterEach(() => { delete process.env.OURA_TOKEN; });

      it('reads the token from the environment and sends it in the Authorization header', async () => {
        const headerPromise = captureRequestHeaders();
        const client = new OuraClient();
        await client.fetch('daily_sleep', '2026-05-10');
        const headers = await headerPromise;
        expect(headers.get('Authorization')).toBe('Bearer env-token-xyz');
      });
    });

    describe('when neither inline nor env, but a token file exists', () => {
      afterEach(() => { delete process.env.OURA_TOKEN; });

      it('reads the token from the configured file path', async () => {
        // Write a temp token file and point the client at it
        const path = `/tmp/oura-token-test-${process.pid}`;
        await Bun.write(path, 'file-token-abc\n');
        delete process.env.OURA_TOKEN;

        const headerPromise = captureRequestHeaders();
        const client = new OuraClient({ tokenPath: path });
        await client.fetch('daily_sleep', '2026-05-10');
        const headers = await headerPromise;
        expect(headers.get('Authorization')).toBe('Bearer file-token-abc');
      });
    });

    describe('when no token is available anywhere', () => {
      let prevToken: string | undefined;
      beforeEach(() => {
        prevToken = process.env.OURA_TOKEN;
        delete process.env.OURA_TOKEN;
      });
      afterEach(() => {
        if (prevToken !== undefined) process.env.OURA_TOKEN = prevToken;
      });

      it('throws CliError with code TOKEN_MISSING and a hint to run login', () => {
        expect(() => new OuraClient({ tokenPath: '/nonexistent/path/.oura-token' }))
          .toThrow(/No Oura access token/);
        try {
          new OuraClient({ tokenPath: '/nonexistent/path/.oura-token' });
        } catch (e) {
          expect(e).toBeInstanceOf(CliError);
          expect((e as CliError).code).toBe('TOKEN_MISSING');
          expect((e as CliError).hint).toContain('login');
        }
      });
    });
  });

  describe('error handling on API responses', () => {
    beforeEach(() => { process.env.OURA_TOKEN = 'test-token'; });
    afterEach(() => {
      globalThis.fetch = realFetch;
      delete process.env.OURA_TOKEN;
    });

    describe('on 401 Unauthorized', () => {
      it('classifies the response as TOKEN_INVALID so the user knows to re-authenticate', async () => {
        mockFetch({ status: 401, body: '{"detail":"Invalid token"}' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('TOKEN_INVALID');
      });
    });

    describe('on 403 Forbidden', () => {
      it('classifies the response as TOKEN_INVALID so the user knows their token lacks permissions', async () => {
        mockFetch({ status: 403, body: 'forbidden' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('TOKEN_INVALID');
      });
    });

    describe('on 429 Rate Limit', () => {
      it('throws API_ERROR so the caller can surface a retry message', async () => {
        mockFetch({ status: 429, body: 'rate limited' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('API_ERROR');
      });
    });

    describe('on 500 Server Error', () => {
      it('throws API_ERROR so the caller knows the fault is upstream', async () => {
        mockFetch({ status: 500, body: 'oops' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('API_ERROR');
      });
    });

    describe('on 200 with empty body', () => {
      it('throws API_ERROR with a clear message when the API returns an empty body on a 200 response', async () => {
        mockFetch({ status: 200, body: '' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('API_ERROR');
        expect((err as CliError).message).toContain('Empty response body');
      });
    });

    describe('redaction', () => {
      it('removes Bearer tokens from error messages so secrets do not leak to logs', async () => {
        mockFetch({ status: 500, body: 'leaked Bearer abc123def456ghi789' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).message).not.toContain('abc123def456ghi789');
        expect((err as CliError).message).toContain('[REDACTED]');
      });

      it('truncates very long error bodies so terminal output stays readable', async () => {
        mockFetch({ status: 500, body: 'x'.repeat(500) });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', '2026-05-10').catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).message).toContain('truncated');
        expect((err as CliError).message.length).toBeLessThan(300);
      });
    });
  });
});
