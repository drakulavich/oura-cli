import { defineCollection } from './types.js';
import type { OuraCardiovascularAge } from '../api/types.js';

export const cvAge = defineCollection<OuraCardiovascularAge>({
  name: 'cv-age', endpoint: 'daily_cardiovascular_age', table: 'cardiovascular_age',
  description: 'Daily cardiovascular (vascular) age estimate',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'vascular_age', type: 'INTEGER', pick: r => r.vascular_age },
  ],
});
