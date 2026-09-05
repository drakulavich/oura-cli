import type { AnyCollection, Collection, SqlValue } from './types.js';
import { sleep } from './sleep.js';

export type { AnyCollection, Collection, Column, SqlValue } from './types.js';

export const COLLECTIONS: readonly AnyCollection[] = [sleep];

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
