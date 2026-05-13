import { describe, it, expect } from 'bun:test';
import { Command } from 'commander';
import { OuraClient } from '../api/client.js';
import { getClient, todayDate, dateRange, getGlobalOpts } from './helpers.js';

describe('getClient', () => {
  it('uses inline token when --token value is provided', () => {
    const client = getClient({ token: 'inline-pat' });
    expect(client).toBeInstanceOf(OuraClient);
    expect((client as any).token).toBe('inline-pat');
  });

  it('returns an OuraClient without throwing when no token option given', () => {
    // OuraClient only reads the token file lazily on fetch(), not in the constructor
    // when OURA_TOKEN env is also absent — but here we just ensure no throw on construction.
    const prevToken = process.env.OURA_TOKEN;
    delete process.env.OURA_TOKEN;
    // OuraClient constructor does try to read file when no token provided,
    // so we set OURA_TOKEN to prevent the file-read error in CI.
    process.env.OURA_TOKEN = 'env-token';
    const client = getClient({});
    expect(client).toBeInstanceOf(OuraClient);
    if (prevToken === undefined) delete process.env.OURA_TOKEN;
    else process.env.OURA_TOKEN = prevToken;
  });
});

describe('todayDate', () => {
  it('returns YYYY-MM-DD shape for system TZ', () => {
    expect(todayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('honors explicit timezone arg', () => {
    expect(todayDate('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getGlobalOpts', () => {
  it('returns root opts for a doubly-nested command (api-command shape)', () => {
    // Build tree manually: root -> sub -> leaf
    const root = new Command('root').option('--token <t>', 'token');
    const sub = new Command('sleep');
    root.addCommand(sub);
    const leaf = new Command('today');
    sub.addCommand(leaf);
    // Simulate root having parsed a token value
    root.setOptionValue('token', 'mytoken');
    const opts = getGlobalOpts(leaf);
    expect(opts.token).toBe('mytoken');
  });

  it('returns root opts for a singly-nested command (db today shape)', () => {
    const root = new Command('root').option('--db <path>', 'db path');
    const sub = new Command('db');
    root.addCommand(sub);
    root.setOptionValue('db', '/tmp/test.db');
    const opts = getGlobalOpts(sub);
    expect(opts.db).toBe('/tmp/test.db');
  });

  it('returns own opts for a top-level command (sync shape)', () => {
    const root = new Command('root').option('--format <f>', 'format');
    root.setOptionValue('format', 'json');
    const opts = getGlobalOpts(root);
    expect(opts.format).toBe('json');
  });
});

describe('dateRange', () => {
  it('returns end as today and start as days-1 earlier', () => {
    const r = dateRange(7, 'UTC');
    expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // start should be lexicographically <= end
    expect(r.start <= r.end).toBe(true);
  });

  it('returns a range spanning exactly days-1 days', () => {
    const r = dateRange(7, 'UTC');
    const startMs = new Date(`${r.start}T00:00:00Z`).getTime();
    const endMs = new Date(`${r.end}T00:00:00Z`).getTime();
    const diffDays = (endMs - startMs) / 86400000;
    expect(diffDays).toBe(6); // 7 days inclusive = 6 day gap
  });
});
