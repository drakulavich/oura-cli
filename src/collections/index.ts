import type { AnyCollection, Collection, SqlValue } from './types.js';
import type { OuraClient } from '../api/client.js';
import { localDateToUtcRange, shiftDay } from '../lib/time.js';
import { sleep } from './sleep.js';
import { readiness } from './readiness.js';
import { activity } from './activity.js';
import { hr } from './hr.js';
import { spo2 } from './spo2.js';
import { stress } from './stress.js';
import { workout } from './workout.js';
import { sleepPeriods } from './sleep-periods.js';
import { cvAge } from './cv-age.js';

export type { AnyCollection, Collection, Column, SqlValue } from './types.js';

/** Order is the sync order and the order tables appear in `db stats`. */
export const COLLECTIONS: readonly AnyCollection[] = [
  sleep, readiness, activity, hr, spo2, stress, workout, sleepPeriods, cvAge,
];

export function names(): string[] {
  return COLLECTIONS.map(c => c.name);
}

export function byName(name: string): AnyCollection | undefined {
  return COLLECTIONS.find(c => c.name === name);
}

export function ddl(c: AnyCollection): string {
  const cols = c.columns
    .map(col => `    ${col.name} ${col.type}${col.pk ? ' PRIMARY KEY' : ''}${col.unique ? ' UNIQUE' : ''}`)
    .join(',\n');
  const indexes = (c.indexes ?? []).map(i =>
    `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${i.name} ON ${c.table}(${i.columns.join(', ')});`,
  );
  return [`CREATE TABLE IF NOT EXISTS ${c.table} (\n${cols}\n);`, ...indexes].join('\n');
}

export function insertSql(c: AnyCollection): string {
  const verb = c.conflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  const cols = c.columns.map(col => col.name).join(', ');
  const marks = c.columns.map(() => '?').join(', ');
  return `${verb} INTO ${c.table} (${cols}) VALUES (${marks})`;
}

export function rowValues<Row>(c: Collection<Row>, row: Row): SqlValue[] {
  return c.columns.map(col => col.pick(row));
}

const MS_PER_DAY = 86_400_000;

/**
 * Split the inclusive day range [start, end] into consecutive pieces of at most `maxDays` days,
 * then shift each piece's bounds by `offset` so endpoints with exclusive bounds still return
 * exactly the days asked for (see `Collection.dayRangeOffset`).
 */
function dateQueries(start: string, end: string, maxDays: number | undefined, offset: readonly [number, number]): Array<Record<string, string>> {
  const query = (s: string, e: string) => ({ start_date: shiftDay(s, offset[0]), end_date: shiftDay(e, offset[1]) });
  if (!maxDays) return [query(start, end)];
  const out: Array<Record<string, string>> = [];
  for (let s = start; s <= end; s = shiftDay(s, maxDays)) {
    const e = shiftDay(s, maxDays - 1);
    out.push(query(s, e < end ? e : end));
  }
  return out;
}

/**
 * Split the UTC instants covering the local days [start, end] into pieces of at most
 * `maxDays` × 24h. Both heartrate bounds are inclusive at millisecond precision, so a piece
 * ends 1 ms before the next one starts and the last ends 1 ms before the next local midnight:
 * no sample is fetched twice and none falls in a gap, on DST transition days included.
 */
function datetimeQueries(start: string, end: string, tz: string, maxDays: number | undefined): Array<Record<string, string>> {
  const from = Date.parse(localDateToUtcRange(start, tz)[0]);
  const to = Date.parse(localDateToUtcRange(end, tz)[1]) - 1;
  const span = (maxDays ?? Infinity) * MS_PER_DAY;
  const out: Array<Record<string, string>> = [];
  for (let s = from; s <= to; s += span) {
    out.push({ start_datetime: new Date(s).toISOString(), end_datetime: new Date(Math.min(s + span - 1, to)).toISOString() });
  }
  return out;
}

/**
 * One query per request needed to cover the inclusive local-day range [start, end] in `tz`,
 * shaped the way the collection's endpoint expects (`rangeParams`) and no longer than the
 * endpoint allows (`maxRangeDays`). Empty when the range is inverted.
 */
export function rangeQueries(c: AnyCollection, start: string, end: string, tz: string): Array<Record<string, string>> {
  if (start > end) return [];
  return c.rangeParams === 'date'
    ? dateQueries(start, end, c.maxRangeDays, c.dayRangeOffset ?? [0, 0])
    : datetimeQueries(start, end, tz, c.maxRangeDays);
}

/** Every row of `c` for the inclusive local-day range [start, end] in `tz`, across range pieces and pages. */
export async function fetchCollection(client: OuraClient, c: AnyCollection, start: string, end: string, tz: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const query of rangeQueries(c, start, end, tz)) {
    for (const row of await client.fetch<unknown>(c.endpoint, query)) rows.push(row);
  }
  return rows;
}

export function jsonSchema(c: AnyCollection): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://github.com/drakulavich/oura-cli/blob/main/docs/schemas/${c.name}.json`,
    title: `oura-cli fetch ${c.name} output`,
    description: c.description,
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: true,
      required: c.identity.map(i => i.field),
      properties: Object.fromEntries(c.identity.map(i => [
        i.field,
        { type: 'string', ...(i.format ? { format: i.format } : {}), description: i.description },
      ])),
    },
  };
}
