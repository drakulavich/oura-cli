import { defineCollection } from './types.js';
import type { OuraRingBatteryLevel } from '../api/types.js';

// Like heartrate: a timeseries without ids, keyed by timestamp, at most 30 days per request
// (31 days → HTTP 400, verified live 2026-09-06). `day` is the date written in the timestamp.
export const battery = defineCollection<OuraRingBatteryLevel>({
  name: 'battery', endpoint: 'ring_battery_level', table: 'ring_battery_level',
  description: 'Ring battery level events (percent) with charging state',
  conflict: 'ignore', rangeParams: 'datetime', maxRangeDays: 30,
  identity: [{ field: 'timestamp', format: 'date-time', description: 'ISO 8601 timestamp of the event' }],
  columns: [
    { name: 'timestamp', type: 'TEXT', pick: r => r.timestamp },
    { name: 'level', type: 'INTEGER', pick: r => r.level ?? null },
    { name: 'charging', type: 'INTEGER', pick: r => r.charging == null ? null : (r.charging ? 1 : 0) },
    { name: 'in_charger', type: 'INTEGER', pick: r => r.in_charger == null ? null : (r.in_charger ? 1 : 0) },
    { name: 'day', type: 'TEXT', pick: r => r.timestamp.slice(0, 10) },
  ],
  indexes: [
    { name: 'idx_ring_battery_level_unique', columns: ['timestamp'], unique: true },
    { name: 'idx_ring_battery_level_day', columns: ['day'] },
  ],
});
