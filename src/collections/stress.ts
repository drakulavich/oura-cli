import { defineCollection } from './types.js';
import type { OuraStressDay } from '../api/types.js';

export const stress = defineCollection<OuraStressDay>({
  name: 'stress', endpoint: 'daily_stress', table: 'daily_stress',
  description: 'Daily stress summary with high-stress and high-recovery seconds',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'day_summary', type: 'TEXT', pick: r => r.day_summary ?? null },
    { name: 'recovery_high', type: 'INTEGER', pick: r => r.recovery_high },
    { name: 'stress_high', type: 'INTEGER', pick: r => r.stress_high },
  ],
});
