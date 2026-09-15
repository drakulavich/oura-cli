import { describe, it, expect } from 'bun:test';
import { assertCalendarDate, assertPositiveInt, assertTimezone } from './validate.js';
import { CliError } from './errors.js';

function badArgs(fn: () => unknown): CliError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).code).toBe('BAD_ARGS');
    return e as CliError;
  }
  throw new Error('did not throw');
}

describe('assertCalendarDate', () => {
  it('returns the value unchanged when valid', () => {
    expect(assertCalendarDate('2026-06-15', '--day')).toBe('2026-06-15');
  });
  it('throws BAD_ARGS naming the label when invalid', () => {
    expect(badArgs(() => assertCalendarDate('2026-02-30', '--day')).message).toContain('--day');
  });
  it('carries a hint that names the flag and shows the format (#167)', () => {
    expect(badArgs(() => assertCalendarDate('tomorrow', '--day')).hint).toBe('Write --day as a calendar day, e.g. 2026-09-01.');
  });
});

describe('assertPositiveInt', () => {
  it.each([['1', 1], ['30', 30], [' 7 ', 7]])('accepts %j', (value, expected) => {
    expect(assertPositiveInt(value, '--days')).toBe(expected);
  });
  it.each(['0', '-1', '1.5', 'abc', '', '7x', '1e3'])('rejects %j with BAD_ARGS', value => {
    expect(badArgs(() => assertPositiveInt(value, '<days>')).message).toContain('<days>');
  });
  it('carries a hint that names the argument (#167)', () => {
    expect(badArgs(() => assertPositiveInt('abc', '--limit')).hint).toBe('Write --limit as a whole number of 1 or more, e.g. 7.');
  });
});

describe('assertTimezone', () => {
  it.each(['UTC', 'Europe/Berlin', 'Asia/Dubai'])('accepts %s', tz => {
    expect(assertTimezone(tz)).toBe(tz);
  });
  it('rejects an unknown zone with BAD_ARGS and a hint', () => {
    const err = badArgs(() => assertTimezone('Not/AZone'));
    expect(err.message).toContain('Not/AZone');
    expect(err.hint).toContain('OURA_TZ');
  });
});
