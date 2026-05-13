import { defineCommand } from 'citty';
import { openDatabase, ensureSchema } from '../db/database.js';
import { commonArgs } from './common.js';

export function healthcheckCommand(version: string) {
  return defineCommand({
    meta: { name: 'healthcheck', description: 'Quick local DB health probe (JSON: {ok, version, latencyMs}).' },
    args: { ...commonArgs },
    run({ args }) {
      const start = Date.now();
      let ok = true;
      let error: string | undefined;
      try {
        const db = openDatabase({ dbPath: args.db });
        ensureSchema(db);
        db.query('SELECT 1').get();
        db.close();
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
      }
      console.log(JSON.stringify({ ok, version, latencyMs: Date.now() - start, ...(error ? { error } : {}) }));
    },
  });
}
