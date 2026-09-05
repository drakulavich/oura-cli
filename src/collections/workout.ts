import { defineCollection } from './types.js';
import type { OuraWorkout } from '../api/types.js';

export const workout = defineCollection<OuraWorkout>({
  name: 'workout', endpoint: 'workout', table: 'workouts',
  description: 'Workout sessions with activity, calories, distance and intensity',
  conflict: 'replace', rangeParams: 'date',
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.day },
    { name: 'activity', type: 'TEXT', pick: r => r.activity },
    { name: 'calories', type: 'REAL', pick: r => r.calories },
    { name: 'distance', type: 'REAL', pick: r => r.distance },
    { name: 'start_datetime', type: 'TEXT', pick: r => r.start_datetime },
    { name: 'end_datetime', type: 'TEXT', pick: r => r.end_datetime },
    { name: 'intensity', type: 'TEXT', pick: r => r.intensity },
    { name: 'label', type: 'TEXT', pick: r => r.label ?? '' },
    { name: 'source', type: 'TEXT', pick: r => r.source },
  ],
});
