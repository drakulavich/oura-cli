import { defineCollection } from './types.js';
import type { OuraActivityDay } from '../api/types.js';

export const activity = defineCollection<OuraActivityDay>({
  name: 'activity', endpoint: 'daily_activity', table: 'daily_activity',
  description: 'Daily activity score, steps, calories and activity-time buckets',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'score', type: 'INTEGER', pick: r => r.score },
    { name: 'active_calories', type: 'INTEGER', pick: r => r.active_calories },
    { name: 'steps', type: 'INTEGER', pick: r => r.steps },
    { name: 'equivalent_walking_distance', type: 'REAL', pick: r => r.equivalent_walking_distance },
    { name: 'high_activity_time', type: 'INTEGER', pick: r => r.high_activity_time },
    { name: 'medium_activity_time', type: 'INTEGER', pick: r => r.medium_activity_time },
    { name: 'low_activity_time', type: 'INTEGER', pick: r => r.low_activity_time },
    { name: 'sedentary_time', type: 'INTEGER', pick: r => r.sedentary_time },
    { name: 'total_calories', type: 'INTEGER', pick: r => r.total_calories },
    { name: 'target_calories', type: 'INTEGER', pick: r => r.target_calories },
    { name: 'contributors', type: 'TEXT', pick: r => JSON.stringify(r.contributors) },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
