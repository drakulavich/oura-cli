import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OuraClient } from '../api/client.js';
import { getClient, todayDate, dateRange } from './helpers.js';

describe('getClient', () => {
  describe('when an inline token is provided via opts', () => {
    it('returns an OuraClient that will use that token', () => {
      process.env.OURA_TOKEN = 'fallback-should-not-be-used';
      const client = getClient({ token: 'inline-pat' });
      delete process.env.OURA_TOKEN;

      expect(client).toBeInstanceOf(OuraClient);
    });
  });

  describe('when no inline token is provided', () => {
    beforeEach(() => { process.env.OURA_TOKEN = 'env-token'; });
    afterEach(() => { delete process.env.OURA_TOKEN; });

    it('falls back to environment-based auth without throwing', () => {
      const client = getClient({});

      expect(client).toBeInstanceOf(OuraClient);
    });
  });
});

describe('todayDate', () => {
  it('returns a YYYY-MM-DD string for the system timezone', () => {
    expect(todayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a YYYY-MM-DD string when an explicit timezone is passed', () => {
    expect(todayDate('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dateRange', () => {
  it('returns start and end dates both in YYYY-MM-DD format', () => {
    const r = dateRange(7, 'UTC');

    expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a range where start is chronologically before or equal to end', () => {
    const r = dateRange(7, 'UTC');

    expect(r.start <= r.end).toBe(true);
  });

  it('spans exactly days-1 calendar days so the range is inclusive of both endpoints', () => {
    const r = dateRange(7, 'UTC');
    const startMs = new Date(`${r.start}T00:00:00Z`).getTime();
    const endMs = new Date(`${r.end}T00:00:00Z`).getTime();
    const diffDays = (endMs - startMs) / 86400000;

    expect(diffDays).toBe(6);
  });
});
