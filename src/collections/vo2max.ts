import { defineCollection } from './types.js';
import type { OuraVo2Max } from '../api/types.js';

// The `vo2max` table has existed since migration 1 and was never populated until this collection
// was added; the columns below match it exactly, so no new migration is needed for it.
export const vo2max = defineCollection<OuraVo2Max>({
  name: 'vo2max', endpoint: 'vO2_max', table: 'vo2max',
  description: 'Daily VO2 max estimate',
  // Live 2026-09-06: returns a record with day D only when start_date <= D < end_date (like workout).
  conflict: 'replace', rangeParams: 'date', dayRangeOffset: [0, 1],
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'vo2_max', type: 'REAL', pick: r => r.vo2_max ?? null },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
