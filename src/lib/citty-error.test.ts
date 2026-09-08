import { describe, it, expect } from 'bun:test';
import { fromCittyError } from './citty-error.js';
import { CliError } from '../lib/errors.js';

function cittyError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('fromCittyError', () => {
  it('turns an unknown command into BAD_ARGS and strips ANSI from the name', () => {
    const err = fromCittyError(cittyError('Unknown command \u001b[36mbogus\u001b[39m', 'E_UNKNOWN_COMMAND')) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe('BAD_ARGS');
    expect(err.message).toBe('Unknown command "bogus".');
    expect(err.message).not.toContain('\u001b');
    expect(err.hint).toContain('--help');
  });

  it.each([
    ['reset', 'use sync'],
    ['hr', 'use fetch'],
  ])('uses the caller-supplied hint for a removed command %s', (name, expected) => {
    const hints = { reset: 'use sync', hr: 'use fetch' };
    const err = fromCittyError(cittyError(`Unknown command ${name}`, 'E_UNKNOWN_COMMAND'), hints) as CliError;
    expect(err.hint).toBe(expected);
  });

  it('does not read hints off Object.prototype', () => {
    const err = fromCittyError(cittyError('Unknown command constructor', 'E_UNKNOWN_COMMAND'), {}) as CliError;
    expect(typeof err.hint).toBe('string');
    expect(err.hint).toContain('--help');
  });

  it('turns a missing positional into BAD_ARGS', () => {
    const err = fromCittyError(cittyError('Missing required positional argument: COLLECTION', 'EARG')) as CliError;
    expect(err.code).toBe('BAD_ARGS');
    expect(err.message).toContain('COLLECTION');
  });

  it('turns "no command" into BAD_ARGS with a --help hint', () => {
    const err = fromCittyError(cittyError('No command specified.', 'E_NO_COMMAND')) as CliError;
    expect(err.code).toBe('BAD_ARGS');
    expect(err.hint).toContain('--help');
  });

  it('passes other errors through untouched', () => {
    const plain = new Error('boom');
    expect(fromCittyError(plain)).toBe(plain);
    const cli = new CliError('API_ERROR', 'x');
    expect(fromCittyError(cli)).toBe(cli);
  });
});

describe('an unknown command that came from a mistyped flag', () => {
  const unknown = (name: string) => Object.assign(new Error(`Unknown command ${name}`), { code: 'E_UNKNOWN_COMMAND' });

  // #95: a misspelled global flag leaves its value in the command position, and citty names the
  // value — which for `--tok <token>` is the user's Personal Access Token, in an error message.
  it.each([
    ['--tok', '--token'],
    ['--toke', '--token'],
    ['--formt', '--format'],
    ['--dbb', '--db'],
  ])('blames %s and suggests %s instead of naming the value', (typo, meant) => {
    const err = fromCittyError(unknown('SECRET-VALUE'), {}, ['db', typo, 'SECRET-VALUE', 'today']) as CliError;
    expect(err.code).toBe('BAD_ARGS');
    expect(err.message).toContain(typo);
    expect(`${err.message} ${err.hint}`).toContain(meant);
    expect(`${err.message} ${err.hint}`).not.toContain('SECRET-VALUE');
  });

  it('does not quote back a value that cannot be a command name', () => {
    const err = fromCittyError(unknown('/home/me/private.db'), {}, ['db', '--database', '/home/me/private.db']) as CliError;
    expect(err.message).toBe('Unknown command.');
    expect(`${err.message} ${err.hint}`).not.toContain('/home/me');
  });

  it('still names a plausible command, which is what makes the hint useful', () => {
    const err = fromCittyError(unknown('bogus'), {}, ['bogus']) as CliError;
    expect(err.message).toBe('Unknown command "bogus".');
  });

  it('keeps the removed-command hint working', () => {
    const err = fromCittyError(unknown('sleep'), { sleep: 'Use `oura-cli fetch sleep`.' }, ['sleep']) as CliError;
    expect(err.hint).toContain('fetch sleep');
  });
});
