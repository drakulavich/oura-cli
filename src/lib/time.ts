export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function formatLocal(utcStr: string, timezone: string): string {
  const dt = new Date(utcStr);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function formatLocalDate(utcStr: string, timezone: string): string {
  return formatLocal(utcStr, timezone).split(' ')[0]!;
}

export function formatLocalTime(utcStr: string, timezone: string): string {
  return formatLocal(utcStr, timezone).split(' ')[1]!;
}

export function todayLocal(timezone: string): string {
  return formatLocalDate(nowUtc(), timezone);
}

function getTimezoneOffsetMs(utc: Date, tz: string): number {
  const tzPart = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(utc).find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = tzPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2]!, 10) * 3600 + parseInt(m[3]!, 10) * 60) * 1000;
}

/** The UTC instant of 00:00 local time on `day` in `tz`, correct across DST transitions. */
function localMidnightMs(day: string, tz: string): number {
  const naiveMs = new Date(`${day}T00:00:00Z`).getTime();
  // The offset in force at local midnight is the one to subtract; a first guess using the
  // offset at the naive instant is off by the DST delta on transition days, so re-read it there.
  const guessMs = naiveMs - getTimezoneOffsetMs(new Date(naiveMs), tz);
  return naiveMs - getTimezoneOffsetMs(new Date(guessMs), tz);
}

/** `[start, end)` UTC instants of the local calendar day: local midnight to the next local midnight. */
export function localDateToUtcRange(localDate: string, timezone: string): [string, string] {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [iso(localMidnightMs(localDate, timezone)), iso(localMidnightMs(shiftDay(localDate, 1), timezone))];
}

export function resolveDefaultTimezone(): string {
  if (process.env.OURA_TZ) return process.env.OURA_TZ;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD for "now" in `timezone` (default: OURA_TZ or the system zone). */
export function today(timezone?: string): string {
  return todayLocal(timezone ?? resolveDefaultTimezone());
}

/** Shift a YYYY-MM-DD date by `delta` whole days. */
export function shiftDay(day: string, delta: number): string {
  const ms = new Date(`${day}T00:00:00Z`).getTime() + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The `n` calendar dates ending at and including `endDay`, ascending. */
export function daysBack(endDay: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftDay(endDay, -i));
  return out;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real YYYY-MM-DD calendar date: "2026-02-30" and "2026-13-01" are not. */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const ms = new Date(`${value}T00:00:00Z`).getTime();
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
