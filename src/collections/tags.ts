import { defineCollection } from './types.js';
import type { OuraEnhancedTag } from '../api/types.js';

// `enhanced_tag` supersedes the legacy `tag` endpoint, which is not offered here.
export const tags = defineCollection<OuraEnhancedTag>({
  name: 'tags', endpoint: 'enhanced_tag', table: 'enhanced_tags',
  description: 'Tags the user added in the app; `day` is the tag start day',
  // Live 2026-09-06: returns a record with start_day D only when start_date <= D < end_date (like workout).
  conflict: 'replace', rangeParams: 'date', dayRangeOffset: [0, 1],
  identity: [
    { field: 'id', description: 'Oura record id' },
    { field: 'start_day', format: 'date', description: 'Day the tag starts on (YYYY-MM-DD)' },
  ],
  columns: [
    { name: 'id', type: 'TEXT', pk: true, pick: r => r.id },
    { name: 'day', type: 'TEXT', pick: r => r.start_day },
    { name: 'end_day', type: 'TEXT', pick: r => r.end_day ?? null },
    { name: 'start_time', type: 'TEXT', pick: r => r.start_time ?? null },
    { name: 'end_time', type: 'TEXT', pick: r => r.end_time ?? null },
    { name: 'tag_type_code', type: 'TEXT', pick: r => r.tag_type_code ?? null },
    { name: 'comment', type: 'TEXT', pick: r => r.comment ?? null },
    { name: 'custom_name', type: 'TEXT', pick: r => r.custom_name ?? null },
  ],
  indexes: [{ name: 'idx_enhanced_tags_day', columns: ['day'] }],
});
