import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { COLLECTIONS, jsonSchema } from '../src/collections/index.js';

const dir = resolve(import.meta.dir, '..', 'docs', 'schemas');
for (const c of COLLECTIONS) {
  const path = resolve(dir, `${c.name}.json`);
  writeFileSync(path, JSON.stringify(jsonSchema(c), null, 2) + '\n');
  console.log(`wrote ${path}`);
}
