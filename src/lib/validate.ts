import { CliError } from './errors.js';
import { isCalendarDate } from './time.js';

/** Return `value` when it is a real calendar date; otherwise throw BAD_ARGS naming `label`. */
export function assertCalendarDate(value: string, label: string): string {
  if (!isCalendarDate(value)) {
    throw new CliError('BAD_ARGS', `${label} must be a real YYYY-MM-DD date, got "${value}".`);
  }
  return value;
}

/** Parse `value` as a positive integer (1, 2, …); otherwise throw BAD_ARGS naming `label`. */
export function assertPositiveInt(value: string, label: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(n) || n < 1) {
    throw new CliError('BAD_ARGS', `${label} must be a positive integer, got "${value}".`);
  }
  return n;
}

/** Return `tz` when Intl knows it as a timezone; otherwise throw BAD_ARGS. */
export function assertTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new CliError('BAD_ARGS', `Unknown timezone "${tz}".`, 'Use an IANA name such as Europe/Berlin (env: OURA_TZ, flag: --tz).');
  }
}
