import { defineCollection } from './types.js';
import type { OuraSpO2Day } from '../api/types.js';

export const spo2 = defineCollection<OuraSpO2Day>({
  name: 'spo2', endpoint: 'daily_spo2', table: 'daily_spo2',
  description: 'Daily blood-oxygen average and breathing disturbance index',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'spo2_average', type: 'REAL', pick: r => r.spo2_percentage?.average ?? null },
    { name: 'breathing_disturbance_index', type: 'REAL', pick: r => r.breathing_disturbance_index },
  ],
});
