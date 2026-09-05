import { defineCollection } from './types.js';
import type { OuraSleepModel } from '../api/types.js';

export const sleepPeriods = defineCollection<OuraSleepModel>({
  name: 'sleep-periods', endpoint: 'sleep', table: 'sleep_model',
  description: 'Individual sleep periods with stages, HRV, heart rate and efficiency',
  conflict: 'replace', rangeParams: 'date', dayRangeOffset: [-1, 0],
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'day', format: 'date', description: 'Date the record applies to (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.day },
    { name: 'average_breath', type: 'REAL', pick: r => r.average_breath },
    { name: 'average_heart_rate', type: 'REAL', pick: r => r.average_heart_rate },
    { name: 'average_hrv', type: 'REAL', pick: r => r.average_hrv },
    { name: 'awake_time', type: 'INTEGER', pick: r => r.awake_time },
    { name: 'bedtime_end', type: 'TEXT', pick: r => r.bedtime_end },
    { name: 'bedtime_start', type: 'TEXT', pick: r => r.bedtime_start },
    { name: 'deep_sleep_duration', type: 'INTEGER', pick: r => r.deep_sleep_duration },
    { name: 'efficiency', type: 'INTEGER', pick: r => r.efficiency },
    { name: 'latency', type: 'INTEGER', pick: r => r.latency },
    { name: 'light_sleep_duration', type: 'INTEGER', pick: r => r.light_sleep_duration },
    { name: 'lowest_heart_rate', type: 'INTEGER', pick: r => r.lowest_heart_rate },
    { name: 'period', type: 'INTEGER', pick: r => r.period },
    { name: 'rem_sleep_duration', type: 'INTEGER', pick: r => r.rem_sleep_duration },
    { name: 'restless_periods', type: 'INTEGER', pick: r => r.restless_periods },
    { name: 'time_in_bed', type: 'INTEGER', pick: r => r.time_in_bed },
    { name: 'total_sleep_duration', type: 'INTEGER', pick: r => r.total_sleep_duration },
    { name: 'type', type: 'TEXT', pick: r => r.type ?? null },
  ],
});
