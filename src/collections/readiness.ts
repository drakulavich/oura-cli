import { defineCollection } from './types.js';
import type { OuraReadinessDay } from '../api/types.js';

export const readiness = defineCollection<OuraReadinessDay>({
  name: 'readiness', endpoint: 'daily_readiness', table: 'daily_readiness',
  description: 'Daily readiness score, contributors and temperature deviation',
  conflict: 'replace', syncWindow: 'range',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'score', type: 'INTEGER', pick: r => r.score },
    { name: 'contributors', type: 'TEXT', pick: r => JSON.stringify(r.contributors) },
    { name: 'temperature_deviation', type: 'REAL', pick: r => r.temperature_deviation },
    { name: 'temperature_trend_deviation', type: 'REAL', pick: r => r.temperature_trend_deviation },
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
  ],
});
