import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Command } from 'commander';
import { OuraClient } from '../api/client.js';
import { getClient, todayDate, dateRange, getGlobalOpts } from './helpers.js';

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

describe('getGlobalOpts', () => {
  it('walks up to the root program to read global options from a doubly-nested command', () => {
    const root = new Command('root').option('--token <t>', 'token');
    const sub = new Command('sleep');
    root.addCommand(sub);
    const leaf = new Command('today');
    sub.addCommand(leaf);
    root.setOptionValue('token', 'mytoken');

    const opts = getGlobalOpts(leaf);

    expect(opts.token).toBe('mytoken');
  });

  it('walks up to the root program to read global options from a singly-nested command', () => {
    const root = new Command('root').option('--db <path>', 'db path');
    const sub = new Command('db');
    root.addCommand(sub);
    root.setOptionValue('db', '/tmp/test.db');

    const opts = getGlobalOpts(sub);

    expect(opts.db).toBe('/tmp/test.db');
  });

  it('returns the command\'s own options when it is the root', () => {
    const root = new Command('root').option('--format <f>', 'format');
    root.setOptionValue('format', 'json');

    const opts = getGlobalOpts(root);

    expect(opts.format).toBe('json');
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
