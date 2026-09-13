import type { ArgDef } from 'citty';

export const commonArgs = {
  format:     { type: 'string',  description: 'Output format: table | json (auto-detected by TTY)' },
  token:      { type: 'string',  description: 'Inline access token (prefer env vars or `oura-cli login`)' },
  db:         { type: 'string',  description: 'Path to SQLite database file (env: OURA_DB_PATH)' },
  tz:         { type: 'string',  description: 'Display timezone (env: OURA_TZ; auto-detected)' },
  'no-color': { type: 'boolean', default: false, description: 'Disable ANSI colors (or set NO_COLOR)' },
} as const satisfies Record<string, ArgDef>;

/**
 * The one line the root help opens with and `manifest` publishes. Short on purpose: citty appends
 * `(oura-cli vX.Y.Z)`, and the banner has to fit 80 columns (#130).
 */
export const CLI_DESCRIPTION = 'Oura Ring data, cached locally, for humans and agents.';
