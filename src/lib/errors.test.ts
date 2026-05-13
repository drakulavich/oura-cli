import { describe, it, expect } from 'bun:test';
import { CliError, exitCodeFor, formatError, redactSecrets, type ErrorEnvelope } from './errors.js';

describe('CliError', () => {
  it('carries code, message, and hint', () => {
    const err = new CliError('TOKEN_MISSING', 'No token', 'Run `oura-cli login`.');
    expect(err.code).toBe('TOKEN_MISSING');
    expect(err.message).toBe('No token');
    expect(err.hint).toBe('Run `oura-cli login`.');
  });
});

describe('exitCodeFor', () => {
  it('maps known error codes to documented exit codes', () => {
    expect(exitCodeFor(new CliError('BAD_ARGS', 'bad'))).toBe(1);
    expect(exitCodeFor(new CliError('TOKEN_MISSING', 'no token'))).toBe(2);
    expect(exitCodeFor(new CliError('API_ERROR', 'fail'))).toBe(3);
    expect(exitCodeFor(new CliError('DB_ERROR', 'fail'))).toBe(4);
  });

  it('maps UNKNOWN code to exit 1', () => {
    expect(exitCodeFor(new CliError('UNKNOWN', 'x'))).toBe(1);
  });

  it('returns 1 for non-CliError throwables', () => {
    expect(exitCodeFor(new Error('plain'))).toBe(1);
  });
});

describe('redactSecrets', () => {
  it('redacts Bearer tokens of 8+ alnum chars', () => {
    const result = redactSecrets('Authorization: Bearer abc123def456ghi789jkl012mno345pqr');
    expect(result).toBe('Authorization: Bearer [REDACTED]');
  });

  it('does not redact short Bearer values (< 8 chars)', () => {
    const result = redactSecrets('Bearer short');
    expect(result).toContain('short');
  });

  it('redacts "token" JSON field values of 8+ chars', () => {
    const result = redactSecrets('{"token":"supersecrettoken123"}');
    expect(result).toBe('{"token":"[REDACTED]"}');
  });

  it('leaves strings without secrets unchanged', () => {
    const result = redactSecrets('{"error":"not found"}');
    expect(result).toBe('{"error":"not found"}');
  });
});

describe('formatError', () => {
  it('emits a JSON envelope in json mode', () => {
    const env: ErrorEnvelope = formatError(new CliError('API_ERROR', 'boom', 'try again'), 'json');
    expect(env.kind).toBe('json');
    const parsed = JSON.parse(env.text);
    expect(parsed.error.code).toBe('API_ERROR');
    expect(parsed.error.message).toBe('boom');
    expect(parsed.error.hint).toBe('try again');
  });

  it('emits a single-line string in table mode', () => {
    const env = formatError(new CliError('API_ERROR', 'boom', 'try again'), 'table');
    expect(env.kind).toBe('text');
    expect(env.text).toContain('boom');
    expect(env.text).toContain('try again');
  });

  it('handles non-CliError throwables', () => {
    const env = formatError(new Error('unexpected'), 'json');
    const parsed = JSON.parse(env.text);
    expect(parsed.error.code).toBe('UNKNOWN');
    expect(parsed.error.message).toBe('unexpected');
  });
});
