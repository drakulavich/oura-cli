import { describe, it, expect } from 'bun:test';
import { resolveFormat } from './format-resolve.js';

describe('resolveFormat', () => {
  describe('when an explicit format flag is passed', () => {
    it('returns table when --format table is set, ignoring TTY state', () => {
      expect(resolveFormat({ explicit: 'table', isTty: false })).toBe('table');
    });

    it('returns json when --format json is set, ignoring TTY state', () => {
      expect(resolveFormat({ explicit: 'json', isTty: true })).toBe('json');
    });

    it('throws CliError when the value is not a recognised format', () => {
      expect(() => resolveFormat({ explicit: 'yaml' as any, isTty: true })).toThrow();
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
