import type { Command } from 'commander';
import { OuraClient } from '../api/client.js';
import { todayLocal, resolveDefaultTimezone } from '../lib/time.js';

export function getGlobalOpts(command: Command): Record<string, unknown> {
  let node: Command | null = command;
  while (node?.parent) {
    node = node.parent;
  }
  return node?.opts() ?? {};
}

export function getClient(opts: { token?: string }): OuraClient {
  return new OuraClient(opts.token ? { token: opts.token } : {});
}

export function todayDate(timezone?: string): string {
  return todayLocal(timezone ?? resolveDefaultTimezone());
}

export function dateRange(days: number, timezone?: string): { start: string; end: string } {
  const tz = timezone ?? resolveDefaultTimezone();
  const end = todayLocal(tz);
  // step back `days` days from today in the same TZ
  const startMs = new Date(`${end}T00:00:00Z`).getTime() - (days - 1) * 86400000;
  const start = new Date(startMs).toISOString().slice(0, 10);
  return { start, end };
}
