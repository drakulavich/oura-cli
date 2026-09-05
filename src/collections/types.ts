import type { OuraEndpoint } from '../api/types.js';

export type SqlType = 'TEXT' | 'INTEGER' | 'REAL';
export type SqlValue = string | number | null;

export interface Column<Row> {
  name: string;
  type: SqlType;
  pick: (row: Row) => SqlValue;
  pk?: boolean;
  unique?: boolean;
}

export interface IndexDef {
  name: string;
  columns: readonly string[];
  unique?: boolean;
}

/** An API field that is always present; drives the JSON Schema `required` list. */
export interface IdentityField {
  field: string;
  format?: 'date' | 'date-time';
  description: string;
}

export interface Collection<Row> {
  /** CLI and manifest name, e.g. 'sleep', 'hr', 'sleep-periods' */
  name: string;
  endpoint: OuraEndpoint;
  table: string;
  description: string;
  columns: readonly Column<Row>[];
  indexes?: readonly IndexDef[];
  conflict: 'replace' | 'ignore';
  /** heartrate is fetched for today only during sync */
  syncWindow: 'range' | 'today-only';
  identity: readonly IdentityField[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCollection = Collection<any>;

export function defineCollection<Row>(c: Collection<Row>): Collection<Row> {
  return c;
}
