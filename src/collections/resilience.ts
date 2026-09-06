import { defineCollection } from './types.js';
import type { OuraResilienceDay } from '../api/types.js';

export const resilience = defineCollection<OuraResilienceDay>({
  name: 'resilience', endpoint: 'daily_resilience', table: 'daily_resilience',
  description: 'Daily resilience level with its sleep-recovery, daytime-recovery and stress contributors',
  conflict: 'replace', rangeParams: 'date', // both bounds inclusive, verified live 2026-09-06
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', unique: true, pick: r => r.day },
    { name: 'level', type: 'TEXT', pick: r => r.level ?? null },
    { name: 'sleep_recovery', type: 'REAL', pick: r => r.contributors?.sleep_recovery ?? null },
    { name: 'daytime_recovery', type: 'REAL', pick: r => r.contributors?.daytime_recovery ?? null },
    { name: 'stress', type: 'REAL', pick: r => r.contributors?.stress ?? null },
  ],
});
