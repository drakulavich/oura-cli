import { defineCollection } from './types.js';
import type { OuraHeartRate } from '../api/types.js';

export const hr = defineCollection<OuraHeartRate>({
  name: 'hr', endpoint: 'heartrate', table: 'heartrate',
  description: 'Heart rate samples (bpm) with source',
  conflict: 'ignore', rangeParams: 'datetime', maxRangeDays: 30,
  identity: [{ field: 'timestamp', format: 'date-time', description: 'ISO 8601 timestamp of the sample' }],
  columns: [
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
    { name: 'bpm', type: 'INTEGER', pick: r => r.bpm },
    { name: 'source', type: 'TEXT', pick: r => r.source },
    { name: 'day', type: 'TEXT', pick: r => r.timestamp.slice(0, 10) },
  ],
  indexes: [
    { name: 'idx_heartrate_ts', columns: ['timestamp'] },
    { name: 'idx_heartrate_unique', columns: ['timestamp', 'source'], unique: true },
    { name: 'idx_heartrate_day', columns: ['day'] },
  ],
});
