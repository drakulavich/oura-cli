import type { ArgDef } from 'citty';
import { emitError, exitCodeFor } from '../lib/errors.js';
import { resolveFormat } from '../lib/format-resolve.js';

export const commonArgs = {
  format:     { type: 'string',  description: 'Output format: table | json (auto-detected by TTY)' },
  token:      { type: 'string',  description: 'Inline access token (prefer env vars or `oura-cli login`)' },
  db:         { type: 'string',  description: 'Path to SQLite database file (env: OURA_DB_PATH)' },
  tz:         { type: 'string',  description: 'Display timezone (env: OURA_TZ; auto-detected)' },
  'no-color': { type: 'boolean', default: false, description: 'Disable ANSI colors (also honors NO_COLOR env)' },
} as const satisfies Record<string, ArgDef>;

type CommonArgs = { format?: string; 'no-color'?: boolean };

export function handleError(err: unknown, args: CommonArgs): never {
  const fmt = resolveFormat({
    explicit: args.format,
    isTty: process.stdout.isTTY === true,
  });
  emitError(err, fmt);
  process.exit(exitCodeFor(err));
}

export function applyNoColor(args: CommonArgs): void {
  if (args['no-color'] || process.env.NO_COLOR) {
    import('chalk').then(({ default: chalk }) => { chalk.level = 0; });
  }
}
