import { defineCollection } from './types.js';
import type { OuraSleepTime } from '../api/types.js';

export const sleepTime = defineCollection<OuraSleepTime>({
  name: 'sleep-time', endpoint: 'sleep_time', table: 'sleep_time',
  description: 'Suggested bedtime window (offsets in seconds from midnight) with status and recommendation',
  conflict: 'replace', rangeParams: 'date', // both bounds inclusive, verified live 2026-09-06
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'status', type: 'TEXT', pick: r => r.status ?? null },
    { name: 'recommendation', type: 'TEXT', pick: r => r.recommendation ?? null },
    { name: 'bedtime_start_offset', type: 'INTEGER', pick: r => r.optimal_bedtime?.start_offset ?? null },
    { name: 'bedtime_end_offset', type: 'INTEGER', pick: r => r.optimal_bedtime?.end_offset ?? null },
    { name: 'day_tz', type: 'INTEGER', pick: r => r.optimal_bedtime?.day_tz ?? null },
  ],
});
