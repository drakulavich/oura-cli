import { describe, it, expect } from 'bun:test';
import { resolveFormat } from './format-resolve.js';

describe('resolveFormat', () => {
  it('returns explicit table when --format table', () => {
    expect(resolveFormat({ explicit: 'table', isTty: false })).toBe('table');
  });

  it('returns explicit json when --format json', () => {
    expect(resolveFormat({ explicit: 'json', isTty: true })).toBe('json');
  });

  it('returns table when no flag and stdout is TTY', () => {
    expect(resolveFormat({ explicit: undefined, isTty: true })).toBe('table');
  });

  it('returns json when no flag and stdout is not TTY', () => {
    expect(resolveFormat({ explicit: undefined, isTty: false })).toBe('json');
  });

  it('throws CliError on invalid value', () => {
    expect(() => resolveFormat({ explicit: 'yaml' as any, isTty: true })).toThrow();
  });
});
