import { OuraClient } from '../api/client.js';
import { todayLocal, resolveDefaultTimezone, shiftDay } from '../lib/time.js';

export function getClient(opts: { token?: string }): OuraClient {
  return new OuraClient(opts.token ? { token: opts.token } : {});
}

export function todayDate(timezone?: string): string {
  return todayLocal(timezone ?? resolveDefaultTimezone());
}

export function dateRange(days: number, timezone?: string): { start: string; end: string } {
  const end = todayLocal(timezone ?? resolveDefaultTimezone());
  return { start: shiftDay(end, -(days - 1)), end };
}
