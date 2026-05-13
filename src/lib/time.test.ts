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
  it('returns an ISO 8601 timestamp with a Z suffix and no sub-second component', () => {
    expect(nowUtc()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('formatLocal', () => {
  it('converts a UTC timestamp into the wall-clock time for the given timezone', () => {
    expect(formatLocal('2026-05-12T08:30:00Z', 'Asia/Dubai')).toBe('2026-05-12 12:30');
    expect(formatLocal('2026-05-12T08:30:00Z', 'UTC')).toBe('2026-05-12 08:30');
  });
});

describe('formatLocalDate and formatLocalTime', () => {
  it('splits the timestamp into date and time parts independently', () => {
    expect(formatLocalDate('2026-05-12T08:30:00Z', 'UTC')).toBe('2026-05-12');
    expect(formatLocalTime('2026-05-12T08:30:00Z', 'UTC')).toBe('08:30');
  });
});

describe('todayLocal', () => {
  it('returns a YYYY-MM-DD string for the given timezone', () => {
    expect(todayLocal('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('localDateToUtcRange', () => {
  it('converts a Dubai date to the correct UTC window accounting for UTC+4 offset', () => {
    const [start, end] = localDateToUtcRange('2026-05-12', 'Asia/Dubai');

    expect(start).toBe('2026-05-11T20:00:00Z');
    expect(end).toBe('2026-05-12T20:00:00Z');
  });

  it('returns midnight-to-midnight UTC when the timezone is UTC', () => {
    const [start, end] = localDateToUtcRange('2026-05-12', 'UTC');

    expect(start).toBe('2026-05-12T00:00:00Z');
    expect(end).toBe('2026-05-13T00:00:00Z');
  });
});

describe('resolveDefaultTimezone', () => {
  it('returns a non-empty IANA timezone identifier', () => {
    expect(resolveDefaultTimezone()).toMatch(/^[A-Z][A-Za-z_+\-0-9/]+$/);
  });
});
