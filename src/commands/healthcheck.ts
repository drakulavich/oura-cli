import { defineCommand } from 'citty';
import { openDatabase, ensureSchema } from '../db/open.js';
import type { ArgsDef } from 'citty';
import { commonArgs } from './common.js';
import { assertKnownArgs } from './run-command.js';

export function healthcheckCommand(version: string) {
  return defineCommand({
    meta: { name: 'healthcheck', description: 'Fast liveness probe: opens the local database and runs one query (JSON: {ok, version, latencyMs}, plus error when ok is false). It proves the file opens, not that its contents are intact — `doctor` checks that.' },
    args: { ...commonArgs },
    run({ args }) {
      assertKnownArgs(commonArgs as ArgsDef, args as Record<string, unknown>);
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
