import { defineCollection } from './types.js';
import type { OuraRestModePeriod } from '../api/types.js';

export const restMode = defineCollection<OuraRestModePeriod>({
  name: 'rest-mode', endpoint: 'rest_mode_period', table: 'rest_mode_periods',
  description: 'Rest mode periods; `day` is the period start day, episodes are kept as JSON',
  // Live 2026-09-06: returns a record with start_day D only when start_date <= D < end_date (like workout).
  conflict: 'replace', rangeParams: 'date', dayRangeOffset: [0, 1],
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'start_day', format: 'date', description: 'First day of the period (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.start_day },
    { name: 'end_day', type: 'TEXT', pick: r => r.end_day ?? null },
    { name: 'start_time', type: 'TEXT', pick: r => r.start_time ?? null },
    { name: 'end_time', type: 'TEXT', pick: r => r.end_time ?? null },
    { name: 'episodes', type: 'TEXT', pick: r => r.episodes == null ? null : JSON.stringify(r.episodes) },
  ],
  indexes: [{ name: 'idx_rest_mode_periods_day', columns: ['day'] }],
});
