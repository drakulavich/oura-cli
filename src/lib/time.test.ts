import { describe, it, expect } from 'bun:test';
import {
  nowUtc,
  formatLocal,
  formatLocalDate,
  formatLocalTime,
  todayLocal,
  localDateToUtcRange,
  resolveDefaultTimezone,
} from './time.js';

describe('nowUtc', () => {
  it('returns ISO 8601 with Z suffix and no milliseconds', () => {
    const s = nowUtc();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('formatLocal', () => {
  it('formats UTC into a given timezone', () => {
    expect(formatLocal('2026-05-12T08:30:00Z', 'Asia/Dubai')).toBe('2026-05-12 12:30');
    expect(formatLocal('2026-05-12T08:30:00Z', 'UTC')).toBe('2026-05-12 08:30');
  });
});

describe('formatLocalDate / formatLocalTime', () => {
  it('returns date and time parts independently', () => {
    expect(formatLocalDate('2026-05-12T08:30:00Z', 'UTC')).toBe('2026-05-12');
    expect(formatLocalTime('2026-05-12T08:30:00Z', 'UTC')).toBe('08:30');
  });
});

describe('todayLocal', () => {
  it('returns a YYYY-MM-DD shaped string', () => {
    expect(todayLocal('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('localDateToUtcRange', () => {
  it('converts a Dubai date to its UTC range', () => {
    const [start, end] = localDateToUtcRange('2026-05-12', 'Asia/Dubai');
    expect(start).toBe('2026-05-11T20:00:00Z');
    expect(end).toBe('2026-05-12T20:00:00Z');
  });

  it('returns UTC-aligned range when timezone is UTC', () => {
    const [start, end] = localDateToUtcRange('2026-05-12', 'UTC');
    expect(start).toBe('2026-05-12T00:00:00Z');
    expect(end).toBe('2026-05-13T00:00:00Z');
  });
});

describe('resolveDefaultTimezone', () => {
  it('returns a non-empty IANA-shaped string', () => {
    expect(resolveDefaultTimezone()).toMatch(/^[A-Z][A-Za-z_+\-0-9/]+$/);
  });
});
