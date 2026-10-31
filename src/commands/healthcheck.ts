import { defineCommand } from 'citty';
import { openDatabase, ensureSchema } from '../db/open.js';
import type { ArgsDef } from 'citty';
import { commonArgs } from './common.js';
import { assertKnownArgs } from './run-command.js';
import { refuseTable } from '../lib/format-resolve.js';

export function healthcheckCommand(version: string) {
  return defineCommand({
    meta: { name: 'healthcheck', description: 'JSON liveness probe: the database answers a query.' },
    args: { ...commonArgs },
    run({ args }) {
      assertKnownArgs(commonArgs as ArgsDef, args as Record<string, unknown>);
      refuseTable(args.format);
      const start = Date.now();
      let ok = true;
      let error: string | undefined;
      try {
        const db = openDatabase(args.db);
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
