import { defineCollection } from './types.js';
import type { OuraSleepDay } from '../api/types.js';

export const sleep = defineCollection<OuraSleepDay>({
  name: 'sleep',
  endpoint: 'daily_sleep',
  table: 'daily_sleep',
  description: 'Daily sleep score and contributors',
  conflict: 'replace',
  syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'score', type: 'INTEGER', pick: r => r.score },
    { name: 'contributors', type: 'TEXT', pick: r => JSON.stringify(r.contributors) },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
