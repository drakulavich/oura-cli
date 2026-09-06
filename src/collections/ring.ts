import { defineCollection } from './types.js';
import type { OuraRingConfiguration } from '../api/types.js';

export const ring = defineCollection<OuraRingConfiguration>({
  name: 'ring', endpoint: 'ring_configuration', table: 'ring_configuration',
  description: 'Ring hardware, colour, size, firmware and set-up time; a snapshot list, not a day range',
  conflict: 'replace', rangeParams: 'none',
  identity: [{ field: 'id', description: 'Oura ring id' }],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'color', type: 'TEXT', pick: r => r.color ?? null },
    { name: 'design', type: 'TEXT', pick: r => r.design ?? null },
    { name: 'firmware_version', type: 'TEXT', pick: r => r.firmware_version ?? null },
    { name: 'hardware_type', type: 'TEXT', pick: r => r.hardware_type ?? null },
    { name: 'set_up_at', type: 'TEXT', pick: r => r.set_up_at ?? null },
    { name: 'size', type: 'INTEGER', pick: r => r.size ?? null },
  ],
});
