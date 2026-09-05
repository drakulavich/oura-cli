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
  /**
   * Query parameters the endpoint takes for a day range: `start_date`/`end_date` (YYYY-MM-DD),
   * or `start_datetime`/`end_datetime` (ISO 8601) — the heartrate timeseries uses the latter.
   */
  rangeParams: 'date' | 'datetime';
  /** Longest range (in days) the endpoint accepts per request; longer ranges are split. heartrate: 30. */
  maxRangeDays?: number;
  identity: readonly IdentityField[];
}

// Erases the row type at the registry boundary; each descriptor is typed via defineCollection<Row>.
export type AnyCollection = Collection<any>;

export function defineCollection<Row>(c: Collection<Row>): Collection<Row> {
  return c;
}
