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
  /**
   * Days to add to `start_date` and `end_date` so the request covers exactly the local days asked
   * for. The daily endpoints treat both bounds inclusively; `sleep` returns a record with day D only
   * when start_date < D <= end_date ([-1, 0]); `workout` only when start_date <= D < end_date ([0, 1]).
   * Verified live against the API on 2026-09-05.
   */
  dayRangeOffset?: readonly [start: number, end: number];
  identity: readonly IdentityField[];
}

// Erases the row type at the registry boundary; each descriptor is typed via defineCollection<Row>.
export type AnyCollection = Collection<any>;

export function defineCollection<Row>(c: Collection<Row>): Collection<Row> {
  return c;
}
