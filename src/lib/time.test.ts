import { describe, it, expect, setSystemTime } from 'bun:test';
import {
  isCalendarDate,
  nowUtc,
  formatLocal,
  formatLocalDate,
  formatLocalTime,
  todayLocal,
  localDateToUtcRange,
  resolveDefaultTimezone,
  shiftDay,
  daysBack,
  today,
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

  it('spans 25 hours on the DST fall-back day (Berlin, 2026-10-25)', () => {
    // Midnight is still CEST (+02:00); the next midnight is CET (+01:00).
    expect(localDateToUtcRange('2026-10-25', 'Europe/Berlin')).toEqual(['2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z']);
  });

  it('spans 23 hours on the DST spring-forward day (Berlin, 2026-03-29)', () => {
    expect(localDateToUtcRange('2026-03-29', 'Europe/Berlin')).toEqual(['2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z']);
  });

  it('chains without gaps around a transition: each day ends where the next begins', () => {
    for (const day of ['2026-10-24', '2026-10-25', '2026-03-28', '2026-03-29']) {
      expect(localDateToUtcRange(day, 'America/New_York')[1]).toBe(localDateToUtcRange(shiftDay(day, 1), 'America/New_York')[0]);
    }
  });
});

describe('resolveDefaultTimezone', () => {
  it('returns a non-empty IANA timezone identifier', () => {
    expect(resolveDefaultTimezone()).toMatch(/^[A-Z][A-Za-z_+\-0-9/]+$/);
  });
});

describe('shiftDay', () => {
  it('moves a YYYY-MM-DD date by whole days across a month boundary', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-02-28', 2)).toBe('2026-03-02');
  });
});

describe('daysBack', () => {
  it('returns n ascending dates ending at and including endDay', () => {
    expect(daysBack('2026-06-15', 3)).toEqual(['2026-06-13', '2026-06-14', '2026-06-15']);
  });
  it('returns an empty list for n = 0', () => {
    expect(daysBack('2026-06-15', 0)).toEqual([]);
  });
});

describe('today', () => {
  it('uses OURA_TZ when no timezone is passed', () => {
    const prev = process.env.OURA_TZ;
    process.env.OURA_TZ = 'Pacific/Kiritimati'; // UTC+14: at 20:00Z it is already tomorrow there
    setSystemTime(new Date('2026-06-15T20:00:00Z'));
    try {
      expect(today()).toBe('2026-06-16');
    } finally {
      setSystemTime();
      if (prev === undefined) delete process.env.OURA_TZ; else process.env.OURA_TZ = prev;
    }
  });
});

describe('isCalendarDate', () => {
  it.each(['2026-06-15', '2024-02-29', '2026-12-31'])('accepts %s', d => {
    expect(isCalendarDate(d)).toBe(true);
  });
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-6-15', '06/15/2026', '2026-06-15T00:00:00Z', ''])('rejects %j', d => {
    expect(isCalendarDate(d)).toBe(false);
  });
});
