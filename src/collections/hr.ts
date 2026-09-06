import { defineCollection } from './types.js';
import type { OuraHeartRate } from '../api/types.js';

export const hr = defineCollection<OuraHeartRate>({
  name: 'hr', endpoint: 'heartrate', table: 'heartrate',
  description: 'Heart rate samples (bpm) with source',
  conflict: 'ignore', rangeParams: 'datetime', maxRangeDays: 30,
  // Oura publishes workout heart rate days late, behind the watermark: a probe on a live account
  // found 8,004 samples missing over 9 days that an incremental sync would never have fetched.
  // Two weeks covers what was observed; the rows are deduped by the (timestamp, source) index.
  // The cost is pages, not range pieces: at ~1,150 samples a day and 1,000 rows a page this is
  // roughly 17 requests per sync instead of 2, well inside Oura's limits but visible in the
  // `hr` fetched count, which now reads five figures on every run.
  syncLookbackDays: 14,
  identity: [{ field: 'timestamp', format: 'date-time', description: 'ISO 8601 timestamp of the sample' }],
  columns: [
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
    { name: 'bpm', type: 'INTEGER', pick: r => r.bpm },
    { name: 'source', type: 'TEXT', pick: r => r.source },
    // Calendar date as written in Oura's timestamp (UTC in practice; not re-derived from the offset), not the
    // user's local day; `--day`/`--tz` filter by local midnight instead.
    { name: 'day', type: 'TEXT', pick: r => r.timestamp.slice(0, 10) },
  ],
  indexes: [
    { name: 'idx_heartrate_ts', columns: ['timestamp'] },
    { name: 'idx_heartrate_unique', columns: ['timestamp', 'source'], unique: true },
    { name: 'idx_heartrate_day', columns: ['day'] },
  ],
});
