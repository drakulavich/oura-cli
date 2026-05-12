import { OuraClient } from '../api/client.js';

export function getClient(opts: { token?: string }): OuraClient {
  return new OuraClient(opts.token ? { tokenPath: opts.token } : {});
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateRange(days: number): { start: string; end: string } {
  const end = todayDate();
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return { start, end };
}
