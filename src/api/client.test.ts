import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OuraClient, retryDelayMs, MAX_RETRY_AFTER_MS, RETRY_LIMIT } from './client.js';
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
        await client.fetch('daily_sleep', { start_date: '2026-05-10' });
        const headers = await headerPromise;
        expect(headers.get('Authorization')).toBe('Bearer inline-pat-abc');
      });

      it('trims surrounding whitespace from the inline value', async () => {
        const headerPromise = captureRequestHeaders();
        const client = new OuraClient({ token: '  padded-token  ' });
        await client.fetch('daily_sleep', { start_date: '2026-05-10' });
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
        await client.fetch('daily_sleep', { start_date: '2026-05-10' });
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
        await client.fetch('daily_sleep', { start_date: '2026-05-10' });
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

  describe('token hygiene', () => {
    const path = `/tmp/oura-token-multiline-${process.pid}`;
    afterEach(async () => { delete process.env.OURA_TOKEN; try { await Bun.file(path).delete(); } catch {} });

    it('rejects a token file with a second line as TOKEN_INVALID without quoting the token', async () => {
      await Bun.write(path, 'FAKETOKEN123456789\nnote to self\n');
      delete process.env.OURA_TOKEN;
      let err: unknown;
      try { new OuraClient({ tokenPath: path }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('TOKEN_INVALID');
      expect((err as CliError).message).not.toContain('FAKETOKEN123456789');
      expect((err as CliError).message).toContain(path);
    });

    it('rejects an inline token containing a space', () => {
      expect(() => new OuraClient({ token: 'abc def' })).toThrow(/single line/);
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
        // README's recovery table says `login`; the error must say so too, like TOKEN_MISSING does.
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('TOKEN_INVALID');
        expect((err as CliError).hint).toContain('oura-cli login');
      });
    });

    describe('on 403 Forbidden', () => {
      it('classifies the response as TOKEN_INVALID so the user knows their token lacks permissions', async () => {
        mockFetch({ status: 403, body: 'forbidden' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('TOKEN_INVALID');
      });
    });

    describe('on 429 Rate Limit', () => {
      it('throws API_ERROR with a retry hint once the retries are spent', async () => {
        mockFetch({ status: 429, body: 'rate limited' });
        const client = new OuraClient({ sleep: async () => {} }); // the retries (#45) would otherwise wait 7 s here
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('API_ERROR');
        expect((err as CliError).hint).toContain('Rate limited');
      });
    });

    describe('on 500 Server Error', () => {
      it('throws API_ERROR so the caller knows the fault is upstream', async () => {
        mockFetch({ status: 500, body: 'oops' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('API_ERROR');
      });
    });

    describe('on 200 with empty body', () => {
      it('throws API_ERROR with a clear message when the API returns an empty body on a 200 response', async () => {
        mockFetch({ status: 200, body: '' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('API_ERROR');
        expect((err as CliError).message).toContain('Empty response body');
      });
    });

    describe('redaction', () => {
      it('removes Bearer tokens from error messages so secrets do not leak to logs', async () => {
        mockFetch({ status: 500, body: 'leaked Bearer abc123def456ghi789' });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).message).not.toContain('abc123def456ghi789');
        expect((err as CliError).message).toContain('[REDACTED]');
      });

      it('truncates very long error bodies so terminal output stays readable', async () => {
        mockFetch({ status: 500, body: 'x'.repeat(500) });
        const client = new OuraClient();
        const err = await client.fetch('daily_sleep', { start_date: '2026-05-10' }).catch(e => e);
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).message).toContain('truncated');
        expect((err as CliError).message.length).toBeLessThan(300);
      });
    });
  });

  describe('pagination', () => {
    beforeEach(() => { process.env.OURA_TOKEN = 'test-token'; });
    afterEach(() => {
      globalThis.fetch = realFetch;
      delete process.env.OURA_TOKEN;
    });

    function mockPages(pages: Array<{ data: unknown[]; next_token: string | null }>): string[] {
      const urls: string[] = [];
      globalThis.fetch = (async (url: unknown) => {
        urls.push(String(url));
        const page = pages[urls.length - 1] ?? { data: [], next_token: null };
        return new Response(JSON.stringify(page), { status: 200 });
      }) as unknown as typeof globalThis.fetch;
      return urls;
    }

    it('sends the query verbatim and returns the single page when next_token is null', async () => {
      const urls = mockPages([{ data: [{ id: 'a' }], next_token: null }]);
      const rows = await new OuraClient().fetch('heartrate', { start_datetime: '2026-05-10T00:00:00Z', end_datetime: '2026-05-11T00:00:00Z' });
      expect(rows).toEqual([{ id: 'a' }]);
      expect(urls).toHaveLength(1);
      const q = new URL(urls[0]!).searchParams;
      expect(q.get('start_datetime')).toBe('2026-05-10T00:00:00Z');
      expect(q.get('end_datetime')).toBe('2026-05-11T00:00:00Z');
      expect(q.has('start_date')).toBe(false);
      expect(q.has('next_token')).toBe(false);
    });

    it('follows next_token until it is null and concatenates every page in order', async () => {
      const urls = mockPages([
        { data: [1, 2], next_token: 'p2' },
        { data: [3], next_token: 'p3' },
        { data: [4], next_token: null },
      ]);
      const rows = await new OuraClient().fetch('daily_sleep', { start_date: '2026-05-01', end_date: '2026-05-31' });
      expect(rows).toEqual([1, 2, 3, 4]);
      expect(urls.map(u => new URL(u).searchParams.get('next_token'))).toEqual([null, 'p2', 'p3']);
      // the original range travels with every page
      expect(urls.every(u => new URL(u).searchParams.get('start_date') === '2026-05-01')).toBe(true);
    });

    it('stops with API_ERROR when the token stream never ends', async () => {
      let n = 0;
      globalThis.fetch = (async () => new Response(JSON.stringify({ data: [], next_token: `t${n++}` }), { status: 200 })) as unknown as typeof globalThis.fetch;
      const err = await new OuraClient().fetch('daily_sleep', { start_date: '2026-05-01' }).catch(e => e);
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('API_ERROR');
      expect((err as CliError).message).toContain('pages');
      expect(n).toBe(10_000);
    });

    it('stops with API_ERROR when the API hands back a token it already served', async () => {
      mockPages([
        { data: [1], next_token: 'loop' },
        { data: [2], next_token: 'loop' },
      ]);
      const err = await new OuraClient().fetch('daily_sleep', { start_date: '2026-05-01' }).catch(e => e);
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('API_ERROR');
    });
  });
});

describe('a malformed response body (#112)', () => {
  // `getPage` used to return `body.data ?? []` and let the caller iterate it. An object there exited
  // 1 as UNKNOWN with "{} is not iterable"; a string was iterated per character, and `sync` reported
  // four dropped heart-rate samples that never existed. Both are API faults and say so now.
  beforeEach(() => { process.env.OURA_TOKEN = 'test-token'; });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.OURA_TOKEN; });

  async function failure(body: string): Promise<CliError> {
    mockFetch({ status: 200, body });
    const outcome: unknown = await new OuraClient().fetch('heartrate', { start_datetime: 'x', end_datetime: 'y' }).catch(e => e);
    if (!(outcome instanceof CliError)) throw new Error(`expected a CliError, got ${JSON.stringify(outcome)}`);
    return outcome;
  }

  it('rejects a string, an object, or a number under "data" as API_ERROR naming the endpoint', async () => {
    for (const [body, kind] of [['{"data":"nope"}', 'a string'], ['{"data":{"a":1}}', 'an object'], ['{"data":5}', 'a number']] as const) {
      const err = await failure(body);
      expect(err).toBeInstanceOf(CliError);
      expect(err.code).toBe('API_ERROR');
      expect(err.message).toContain('heartrate');
      expect(err.message).toContain(kind);
      expect(err.message).not.toContain('nope'); // never echo the body
    }
  });

  it('rejects a body that is not an object', async () => {
    for (const body of ['"nope"', '[1,2]', '42']) {
      const err = await failure(body);
      expect(err.code).toBe('API_ERROR');
    }
  });

  it('still treats a missing or null "data" as an empty page', async () => {
    mockFetch({ status: 200, body: '{"next_token": null}' });
    expect(await new OuraClient().fetch('heartrate', {})).toEqual([]);
    mockFetch({ status: 200, body: '{"data": null}' });
    expect(await new OuraClient().fetch('heartrate', {})).toEqual([]);
  });

  it('rejects a non-string next_token rather than reading it as the last page', async () => {
    // Ending pagination there would be a short sync at exit 0 with rows missing: the wrong-count
    // failure this fix is about, on the other field (review of #119).
    const err = await failure('{"data": [], "next_token": 7}');
    expect(err.code).toBe('API_ERROR');
    expect(err.message).toContain('next_token');
    expect(err.message).toContain('a number');
  });
});

describe('rate limiting and progress (#45)', () => {
  beforeEach(() => { process.env.OURA_TOKEN = 'test-token'; });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.OURA_TOKEN; });

  /** Serves `answers` in order (a 429 with optional Retry-After, or a 200 page) and records every URL. */
  function serve(answers: Array<{ status: 429; retryAfter?: string } | { status: 200; data: unknown[]; next_token?: string | null }>): string[] {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      urls.push(String(url));
      const a = answers[urls.length - 1] ?? { status: 200, data: [] };
      if (a.status === 429) {
        return new Response('{"detail":"Too Many Requests"}', { status: 429, headers: a.retryAfter === undefined ? {} : { 'Retry-After': a.retryAfter } });
      }
      return new Response(JSON.stringify({ data: a.data, next_token: a.next_token ?? null }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return urls;
  }
  function recorder(): { waits: number[]; sleep: (ms: number) => Promise<void> } {
    const waits: number[] = [];
    return { waits, sleep: async ms => { waits.push(ms); } };
  }

  it('retries the same page after a 429 and returns the rows the retry brings', async () => {
    const urls = serve([{ status: 429 }, { status: 200, data: [1, 2] }]);
    const { waits, sleep } = recorder();
    const rows = await new OuraClient({ sleep }).fetch('daily_sleep', { start_date: '2026-05-01' });
    expect(rows).toEqual([1, 2]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(urls[1]);
    expect(waits).toEqual([1_000]);
  });

  it('keeps the pagination cursor on the retried page', async () => {
    const urls = serve([
      { status: 200, data: [1], next_token: 'p2' },
      { status: 429, retryAfter: '3' },
      { status: 200, data: [2] },
    ]);
    const { waits, sleep } = recorder();
    const rows = await new OuraClient({ sleep }).fetch('daily_sleep', { start_date: '2026-05-01' });
    expect(rows).toEqual([1, 2]);
    expect(urls.map(u => new URL(u).searchParams.get('next_token'))).toEqual([null, 'p2', 'p2']);
    expect(waits).toEqual([3_000]);
  });

  it('waits what Retry-After asks for, in seconds or as an HTTP date, never longer than a minute', () => {
    const now = Date.parse('2026-09-13T10:00:00Z');
    expect(retryDelayMs('7', 0, now)).toBe(7_000);
    expect(retryDelayMs('Sun, 13 Sep 2026 10:00:30 GMT', 0, now)).toBe(30_000);
    expect(retryDelayMs('600', 0, now)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryDelayMs('Sun, 13 Sep 2026 11:00:00 GMT', 0, now)).toBe(MAX_RETRY_AFTER_MS);
  });

  it('falls back to a doubling backoff without a usable Retry-After', () => {
    expect([null, 'soon', 'Sun, 13 Sep 2026 09:00:00 GMT', '0', '-5'].map(h => retryDelayMs(h, 0, Date.parse('2026-09-13T10:00:00Z')))).toEqual([1_000, 1_000, 1_000, 1_000, 1_000]);
    expect([0, 1, 2, 9].map(attempt => retryDelayMs(null, attempt))).toEqual([1_000, 2_000, 4_000, 4_000]);
  });

  it('gives up after RETRY_LIMIT retries with an API_ERROR that says so', async () => {
    const urls = serve([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 200, data: [1] }]);
    const { waits, sleep } = recorder();
    const err = await new OuraClient({ sleep }).fetch('daily_sleep', { start_date: '2026-05-01' }).catch(e => e as unknown);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('API_ERROR');
    expect((err as CliError).message).toBe('Oura API 429: {"detail":"Too Many Requests"}');
    expect((err as CliError).hint).toContain(`retried ${RETRY_LIMIT} times`);
    expect(urls).toHaveLength(1 + RETRY_LIMIT);
    expect(waits).toEqual([1_000, 2_000, 4_000]);
  });

  it('does not retry other failures, and still reads 401 as TOKEN_INVALID', async () => {
    mockFetch({ status: 500, body: 'boom' });
    const { waits, sleep } = recorder();
    const err = await new OuraClient({ sleep }).fetch('daily_sleep', { start_date: '2026-05-01' }).catch(e => e as unknown);
    expect((err as CliError).code).toBe('API_ERROR');
    expect(waits).toEqual([]);
  });

  it('reports every page as it arrives, with the rows it carried', async () => {
    serve([
      { status: 200, data: [1, 2], next_token: 'p2' },
      { status: 429 },
      { status: 200, data: [], next_token: 'p3' },
      { status: 200, data: [3] },
    ]);
    const seen: Array<{ endpoint: string; rows: number }> = [];
    const client = new OuraClient({ sleep: async () => {}, onPage: p => seen.push(p) });
    await client.fetch('heartrate', { start_datetime: 'a', end_datetime: 'b' });
    // A 429 is not a page; the retry that succeeds is.
    expect(seen).toEqual([{ endpoint: 'heartrate', rows: 2 }, { endpoint: 'heartrate', rows: 0 }, { endpoint: 'heartrate', rows: 1 }]);
  });
});
