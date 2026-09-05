import type { AnyCollection, Collection, SqlValue } from './types.js';
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

/** Split the inclusive day range [start, end] into consecutive pieces of at most `maxDays` days. */
function chunkDays(start: string, end: string, maxDays: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let s = start; s <= end; s = shiftDay(s, maxDays)) {
    const e = shiftDay(s, maxDays - 1);
    out.push([s, e < end ? e : end]);
  }
  return out;
}

/**
 * One query per request needed to cover the inclusive local-day range [start, end] in `tz`,
 * shaped the way the collection's endpoint expects: plain dates, or UTC instants covering
 * those days. A single query unless the endpoint caps the range (`maxRangeDays`).
 */
export function rangeQueries(c: AnyCollection, start: string, end: string, tz: string): Array<Record<string, string>> {
  const pieces = c.maxRangeDays ? chunkDays(start, end, c.maxRangeDays) : [[start, end] as [string, string]];
  return pieces.map(([s, e]): Record<string, string> => c.rangeParams === 'date'
    ? { start_date: s, end_date: e }
    : { start_datetime: localDateToUtcRange(s, tz)[0], end_datetime: localDateToUtcRange(e, tz)[1] });
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
