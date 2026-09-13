import { describe, it, expect } from 'bun:test';
import { resolveFormat } from './format-resolve.js';
import { CliError } from './errors.js';

describe('resolveFormat', () => {
  describe('when an explicit format flag is passed', () => {
    it('returns table when --format table is set, ignoring TTY state', () => {
      expect(resolveFormat({ explicit: 'table', isTty: false })).toBe('table');
    });

    it('returns json when --format json is set, ignoring TTY state', () => {
      expect(resolveFormat({ explicit: 'json', isTty: true })).toBe('json');
    });

    it('throws CliError when the value is not a recognised format, with the valid values as the hint (#121)', () => {
      let err: unknown;
      try { resolveFormat({ explicit: 'yaml' as any, isTty: true }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toBe('Unknown --format value: "yaml".');
      expect((err as CliError).hint).toBe('Valid values: table, json.'); // the order the describe manifest advertises
    });

    it('says a bare --format has no value, the way --db does, rather than calling "" an unknown value (#121)', () => {
      let err: unknown;
      try { resolveFormat({ explicit: '', isTty: true }); } catch (e) { err = e; }
      expect((err as CliError).code).toBe('BAD_ARGS');
      expect((err as CliError).message).toBe('--format has no value');
      expect((err as CliError).hint).toContain('remove --format');
    });
  });

  describe('when no format flag is passed', () => {
    it('returns table when stdout is a TTY so interactive users get a readable display', () => {
      expect(resolveFormat({ explicit: undefined, isTty: true })).toBe('table');
    });

    it('returns json when stdout is not a TTY so piped consumers get machine-readable output', () => {
      expect(resolveFormat({ explicit: undefined, isTty: false })).toBe('json');
    });
  });
});
