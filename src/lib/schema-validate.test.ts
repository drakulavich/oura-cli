import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMAS_DIR = resolve(import.meta.dir, '..', '..', 'docs', 'schemas');

describe('JSON schemas in docs/schemas/', () => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);

  const files = readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'));

  it('contains the expected set of schema files', () => {
    expect(files.sort()).toEqual([
      'activity.json', 'cv-age.json', 'describe.json', 'doctor.json', 'hr.json', 'readiness.json',
      'sleep-periods.json', 'sleep.json', 'spo2.json', 'stress.json', 'workout.json',
    ].sort());
  });

  for (const file of files) {
    it(`${file} parses as valid JSON Schema 2020-12 so agents can rely on its shape`, () => {
      const raw = readFileSync(join(SCHEMAS_DIR, file), 'utf-8');
      const schema = JSON.parse(raw);
      const validate = ajv.compile(schema);
      expect(typeof validate).toBe('function');
    });
  }

  it('every command outputSchema reference in the manifest points at a file that exists in docs/schemas/', async () => {
    const { buildManifest } = await import('../commands/describe.js');
    const { fetchCommand } = await import('../commands/fetch.js');
    const { doctorCommand } = await import('../commands/doctor.js');
    const subCommandsForTest = { fetch: fetchCommand, doctor: doctorCommand };
    const manifest = buildManifest('0.3.0', subCommandsForTest);
    for (const cmd of manifest.commands) {
      if (cmd.outputSchema) {
        const filename = cmd.outputSchema.split('/').pop()!;
        expect(files).toContain(filename);
      }
      for (const ref of Object.values(cmd.outputSchemas ?? {})) {
        const filename = ref.split('/').pop()!;
        expect(files).toContain(filename);
      }
    }
  });

  it('describe.json validates the output of buildManifest', async () => {
    const { buildManifest } = await import('../commands/describe.js');
    const { fetchCommand } = await import('../commands/fetch.js');
    const { doctorCommand } = await import('../commands/doctor.js');
    const subCommandsForTest = { fetch: fetchCommand, doctor: doctorCommand };
    const manifest = buildManifest('0.3.0', subCommandsForTest);
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'describe.json'), 'utf-8'));
    // Fresh Ajv instance to avoid "schema already exists" collision with the loop above
    const ajv2 = new Ajv({ strict: false });
    addFormats(ajv2);
    const validate = ajv2.compile(schema);
    const ok = validate(manifest);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });
});
