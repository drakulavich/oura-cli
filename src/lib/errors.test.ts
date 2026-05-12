import { describe, it, expect } from 'bun:test';
import { CliError, exitCodeFor, formatError, type ErrorEnvelope } from './errors.js';

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

  it('returns 1 for unknown CliError codes', () => {
    expect(exitCodeFor(new CliError('WEIRD', 'x'))).toBe(1);
  });

  it('returns 1 for non-CliError throwables', () => {
    expect(exitCodeFor(new Error('plain'))).toBe(1);
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
