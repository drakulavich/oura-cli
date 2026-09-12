import type { SubCommandsDef } from 'citty';
import { loginCommand } from './login.js';
import { describeCommand } from './describe.js';
import { syncCommand } from './sync.js';
import { dbCommand } from './db.js';
import { reportCommand } from './report.js';
import { healthcheckCommand } from './healthcheck.js';
import { doctorCommand } from './doctor.js';
import { manifestCommand } from './manifest.js';
import { fetchCommand } from './fetch.js';

/**
 * Every top-level command, as `src/index.ts` registers it. Built here rather than in the entry point
 * so the describe and manifest contract tests can snapshot the real set: a fixture subset let `sync`
 * grow a flag without moving the snapshot (#104). A new command is added here, in `SUBCOMMANDS`
 * (src/lib/argv-normalize.ts), and shows up in the snapshot diff.
 */
export function buildRegistry(version: string): SubCommandsDef {
  // Null prototype: otherwise `oura-cli constructor` resolves to Object.prototype.constructor and exits 0 silently.
  const subCommands: SubCommandsDef = Object.assign(Object.create(null) as SubCommandsDef, {
    login:       loginCommand,
    describe:    describeCommand(version, () => subCommands),
    healthcheck: healthcheckCommand(version),
    doctor:      doctorCommand,
    manifest:    manifestCommand(version, () => subCommands),
    fetch:       fetchCommand,
    sync:        syncCommand,
    db:          dbCommand,
    report:      reportCommand,
  });
  return subCommands;
}
