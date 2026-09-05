import { describe, it, expect } from 'bun:test';
import { CliError, exitCodeFor, formatError, redactSecrets, type ErrorEnvelope } from './errors.js';

describe('CliError', () => {
  it('exposes code, message, and hint as public fields', () => {
    const err = new CliError('TOKEN_MISSING', 'No token', 'Run `oura-cli login`.');

    expect(err.code).toBe('TOKEN_MISSING');
    expect(err.message).toBe('No token');
    expect(err.hint).toBe('Run `oura-cli login`.');
  });

  describe('exitCodeFor', () => {
    describe('returns the documented exit code for each known error', () => {
      it('BAD_ARGS → 1', () => {
        expect(exitCodeFor(new CliError('BAD_ARGS', 'bad'))).toBe(1);
      });

      it('TOKEN_MISSING → 2', () => {
        expect(exitCodeFor(new CliError('TOKEN_MISSING', 'no token'))).toBe(2);
      });

      it('TOKEN_INVALID → 2', () => {
        expect(exitCodeFor(new CliError('TOKEN_INVALID', 'bad token'))).toBe(2);
      });

      it('API_ERROR → 3', () => {
        expect(exitCodeFor(new CliError('API_ERROR', 'fail'))).toBe(3);
      });

      it('DB_ERROR → 4', () => {
        expect(exitCodeFor(new CliError('DB_ERROR', 'fail'))).toBe(4);
      });

      it('UNKNOWN → 1', () => {
        expect(exitCodeFor(new CliError('UNKNOWN', 'x'))).toBe(1);
      });
    });

    it('falls back to 1 for any non-CliError throwable', () => {
      expect(exitCodeFor(new Error('plain'))).toBe(1);
    });
  });

  describe('formatError', () => {
    it('redacts a bearer token quoted by an unexpected non-CliError', () => {
      const env = formatError(new TypeError("Header 'Authorization' has invalid value: 'Bearer FAKETOKEN123456789\nnote'"), 'json');
      expect(env.text).not.toContain('FAKETOKEN123456789');
      expect(JSON.parse(env.text).error.message).toContain('[REDACTED]');
    });

    describe('in json mode', () => {
      it('emits a single-line envelope with code, message, and optional hint', () => {
        const env: ErrorEnvelope = formatError(new CliError('API_ERROR', 'boom', 'try again'), 'json');

        expect(env.kind).toBe('json');
        const parsed = JSON.parse(env.text);
        expect(parsed.error.code).toBe('API_ERROR');
        expect(parsed.error.message).toBe('boom');
        expect(parsed.error.hint).toBe('try again');
      });

      it('represents non-CliError throwables with code UNKNOWN', () => {
        const env = formatError(new Error('unexpected'), 'json');

        const parsed = JSON.parse(env.text);
        expect(parsed.error.code).toBe('UNKNOWN');
        expect(parsed.error.message).toBe('unexpected');
      });
    });

    describe('in table mode', () => {
      it('renders a red one-line error with an indented hint', () => {
        const env = formatError(new CliError('API_ERROR', 'boom', 'try again'), 'table');

        expect(env.kind).toBe('text');
        expect(env.text).toContain('boom');
        expect(env.text).toContain('try again');
      });
    });
  });

  describe('redactSecrets', () => {
    it('replaces Bearer tokens with [REDACTED] regardless of token length', () => {
      const result = redactSecrets('Authorization: Bearer abc123def456ghi789jkl012mno345pqr');

      expect(result).toBe('Authorization: Bearer [REDACTED]');
    });

    it('replaces "token":"..." JSON fields with [REDACTED]', () => {
      const result = redactSecrets('{"token":"supersecrettoken123"}');

      expect(result).toBe('{"token":"[REDACTED]"}');
    });

    it('leaves non-secret text untouched', () => {
      const result = redactSecrets('{"error":"not found"}');

      expect(result).toBe('{"error":"not found"}');
    });
  });
});
