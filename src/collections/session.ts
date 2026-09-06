import { defineCollection } from './types.js';
import type { OuraSession } from '../api/types.js';

export const session = defineCollection<OuraSession>({
  name: 'session', endpoint: 'session', table: 'sessions',
  description: 'Guided sessions (meditation, breathing, naps, rest) with their sample series as JSON',
  // Unverified: the test account has no sessions. Every event-shaped endpoint probed so far (workout,
  // rest_mode_period, enhanced_tag, vO2_max) excludes end_date, so session is assumed to as well.
  conflict: 'replace', rangeParams: 'date', dayRangeOffset: [0, 1],
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the session belongs to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.day },
    { name: 'type', type: 'TEXT', pick: r => r.type ?? null },
    { name: 'mood', type: 'TEXT', pick: r => r.mood ?? null },
    { name: 'start_datetime', type: 'TEXT', pick: r => r.start_datetime },
    { name: 'end_datetime', type: 'TEXT', pick: r => r.end_datetime },
    { name: 'heart_rate', type: 'TEXT', pick: r => r.heart_rate == null ? null : JSON.stringify(r.heart_rate) },
    { name: 'heart_rate_variability', type: 'TEXT', pick: r => r.heart_rate_variability == null ? null : JSON.stringify(r.heart_rate_variability) },
    { name: 'motion_count', type: 'TEXT', pick: r => r.motion_count == null ? null : JSON.stringify(r.motion_count) },
  ],
  indexes: [{ name: 'idx_sessions_day', columns: ['day'] }],
});
