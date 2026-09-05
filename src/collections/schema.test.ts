import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { COLLECTIONS, jsonSchema } from './index.js';

const DIR = resolve(import.meta.dir, '..', '..', 'docs', 'schemas');

describe('docs/schemas/<collection>.json', () => {
  for (const c of COLLECTIONS) {
    it(`${c.name}.json equals jsonSchema() output (run \`bun run schemas\` to refresh)`, () => {
      const onDisk = JSON.parse(readFileSync(resolve(DIR, `${c.name}.json`), 'utf-8'));
      expect(onDisk).toEqual(jsonSchema(c));
    });
  }
  it('requires the identity fields and nothing else', () => {
    const s = jsonSchema(COLLECTIONS.find(c => c.name === 'hr')!) as { items: { required: string[] } };
    expect(s.items.required).toEqual(['timestamp']);
  });
});
