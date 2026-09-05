import { describe, it, expect } from 'bun:test';
import { resolveRange } from './fetch.js';
import { CliError } from '../lib/errors.js';

const T = '2026-06-15';

describe('resolveRange', () => {
  it('defaults to today', () => {
    expect(resolveRange({ today: T })).toEqual({ start: T, end: T });
  });
  it('accepts --day', () => {
    expect(resolveRange({ day: '2026-06-01', today: T })).toEqual({ start: '2026-06-01', end: '2026-06-01' });
  });
  it('accepts --from/--to', () => {
    expect(resolveRange({ from: '2026-06-01', to: '2026-06-07', today: T })).toEqual({ start: '2026-06-01', end: '2026-06-07' });
  });
  it('accepts --days N as the last N days ending today', () => {
    expect(resolveRange({ days: '7', today: T })).toEqual({ start: '2026-06-09', end: T });
  });
  it.each([
    [{ day: '2026-06-01', days: '7' }],
    [{ from: '2026-06-01' }],
    [{ to: '2026-06-01' }],
    [{ from: '2026-06-07', to: '2026-06-01' }],
    [{ day: '06/01/2026' }],
    [{ days: '0' }],
    [{ days: 'x' }],
  ])('rejects %j with BAD_ARGS', (opts) => {
    expect(() => resolveRange({ ...opts, today: T })).toThrow(CliError);
    try { resolveRange({ ...opts, today: T }); } catch (e) { expect((e as CliError).code).toBe('BAD_ARGS'); }
  });
});
