import { describe, it, expect } from 'bun:test';
import { commandTokens, fromCittyError } from './citty-error.js';
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

  it('does not quote back a lower-case secret either, since length gives it away', () => {
    const secret = 'a'.repeat(32);
    const err = fromCittyError(unknown(secret), {}, ['db', '--tokn', secret]) as CliError;
    expect(`${err.message} ${err.hint}`).not.toContain(secret);
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

describe('a command that takes a subcommand (#61)', () => {
  const parents = { db: ['today', 'date', 'week', 'trends', 'stats'] };
  const unknown = (name: string) => Object.assign(new Error(`Unknown command ${name}`), { code: 'E_UNKNOWN_COMMAND' });
  const none = () => Object.assign(new Error('No command specified.'), { code: 'E_NO_COMMAND' });

  it('points a bare `db` at `db --help` and lists what it takes', () => {
    const err = fromCittyError(none(), {}, ['db'], parents) as CliError;
    expect(err.code).toBe('BAD_ARGS');
    expect(err.message).toBe('"db" needs a subcommand.');
    expect(err.hint).toBe('`oura-cli db` takes one of: today, date, week, trends, stats. Run `oura-cli db --help` for details.');
  });

  it('points a misspelt subcommand at `db --help`, not the root help', () => {
    const err = fromCittyError(unknown('toady'), {}, ['db', 'toady'], parents) as CliError;
    expect(err.message).toBe('Unknown command "toady".');
    expect(err.hint).toContain('oura-cli db --help');
    expect(err.hint).not.toContain('oura-cli --help');
  });

  it('keeps the root hint when no parent command was given', () => {
    expect((fromCittyError(none(), {}, [], parents) as CliError).hint).toBe('Run `oura-cli --help` for the list of commands.');
    expect((fromCittyError(unknown('toady'), {}, ['toady'], parents) as CliError).hint).toBe('Run `oura-cli --help` for the list of commands.');
  });

  it('lets a removed-command hint win over the parent hint (`db reset`)', () => {
    const err = fromCittyError(unknown('reset'), { reset: 'db reset was removed.' }, ['db', 'reset'], parents) as CliError;
    expect(err.hint).toBe('db reset was removed.');
  });

  it('does not mistake the value of a global flag for the parent command', () => {
    // `--db db` names a database file; the command token is the one after it.
    const err = fromCittyError(unknown('bogus'), {}, ['--db', 'db', 'bogus'], parents) as CliError;
    expect(err.hint).toBe('Run `oura-cli --help` for the list of commands.');
    const viaFlag = fromCittyError(unknown('toady'), {}, ['--format', 'json', 'db', 'toady'], parents) as CliError;
    expect(viaFlag.hint).toContain('oura-cli db --help');
  });

  it('reads `db --db x` as a missing subcommand, not as the unknown command "x"', () => {
    // citty takes the first token after `db` that does not start with "-" as the subcommand name.
    const err = fromCittyError(unknown(':memory:'), {}, ['db', '--db', ':memory:'], parents) as CliError;
    expect(err.message).toBe('"db" needs a subcommand.');
    expect(err.hint).toContain('oura-cli db --help');
    expect(`${err.message} ${err.hint}`).not.toContain(':memory:');
  });

  it('lists the command tokens with global flags and their values skipped, so a bare parent is found under flags too', () => {
    expect(commandTokens(['db'])).toEqual(['db']);
    expect(commandTokens(['--no-color', 'db'])).toEqual(['db']);
    expect(commandTokens(['--token', 'x', 'db', '--format', 'json'])).toEqual(['db']);
    expect(commandTokens(['db', '--db', 'db', 'today'])).toEqual(['db', 'today']);
    expect(commandTokens(['--format', 'json'])).toEqual([]);
  });

  it('does not read a parent off Object.prototype', () => {
    const err = fromCittyError(none(), {}, ['constructor'], parents) as CliError;
    expect(err.message).toBe('No command specified.');
  });
});
