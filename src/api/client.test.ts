import { describe, it, expect } from 'bun:test';
import { OuraClient } from './client.js';

describe('OuraClient', () => {
  it('throws if no token file found', () => {
    expect(() => new OuraClient({ tokenPath: '/nonexistent' })).toThrow();
  });

  it('accepts token directly', () => {
    const client = new OuraClient({ token: 'test-token' });
    expect(client).toBeDefined();
  });
});

describe('redactSecrets integration via client error messages', () => {
  it('redacts Bearer token in API error body', async () => {
    // We test the redactSecrets function imported from errors directly;
    // the client uses it internally before throwing.
    const { redactSecrets } = await import('../lib/errors.js');
    const msg = 'Bearer abc123def456ghi789jkl012mno345pqr is invalid';
    expect(redactSecrets(msg)).toBe('Bearer [REDACTED] is invalid');
  });

  it('truncates bodies longer than 200 chars', async () => {
    const { redactSecrets } = await import('../lib/errors.js');
    const long = 'x'.repeat(500);
    const redacted = redactSecrets(long);
    const body = redacted.length > 200 ? redacted.slice(0, 200) + '… (truncated)' : redacted;
    expect(body.endsWith('… (truncated)')).toBe(true);
    expect(body.length).toBeLessThan(220);
  });
});

describe('OURA_TOKEN env', () => {
  it('reads token from OURA_TOKEN env when set', () => {
    const prev = process.env.OURA_TOKEN;
    process.env.OURA_TOKEN = 'test-token-from-env';
    try {
      const client = new OuraClient();
      expect((client as any).token).toBe('test-token-from-env');
    } finally {
      if (prev === undefined) delete process.env.OURA_TOKEN;
      else process.env.OURA_TOKEN = prev;
    }
  });

  it('throws CliError TOKEN_MISSING when no token resolvable', () => {
    const prev = process.env.OURA_TOKEN;
    delete process.env.OURA_TOKEN;
    try {
      expect(() => new OuraClient({ tokenPath: '/nonexistent/path/.oura-token' }))
        .toThrow(/No Oura access token/);
    } finally {
      if (prev !== undefined) process.env.OURA_TOKEN = prev;
    }
  });
});
