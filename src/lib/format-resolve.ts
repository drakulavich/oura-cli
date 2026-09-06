import { CliError } from './errors.js';
import { GLOBAL_FLAGS_WITH_VALUE } from './argv-normalize.js';

export type OutputFormat = 'table' | 'json';

export interface ResolveFormatArgs {
  explicit: string | undefined;
  isTty: boolean;
}

/**
 * Reject a `--format` value that is neither shape. Split out of `resolveFormat` because the
 * JSON-only commands (`describe`, `manifest`, `healthcheck`) never resolve a format — they always
 * print JSON — but must still refuse an unknown one instead of exiting 0 (#81).
 */
export function assertValidFormat(explicit: string | undefined): asserts explicit is OutputFormat | undefined {
  if (explicit === undefined || explicit === 'table' || explicit === 'json') return;
  throw new CliError('BAD_ARGS', `Unknown --format value: "${explicit}". Use "table" or "json".`);
}

export function resolveFormat({ explicit, isTty }: ResolveFormatArgs): OutputFormat {
  assertValidFormat(explicit);
  return explicit ?? (isTty ? 'table' : 'json');
}

/**
 * Best-effort format for errors raised before any command parsed its arguments
 * (unknown command, missing positional): honour an explicit --format when it is valid,
 * otherwise fall back to the TTY default. Never throws.
 */
export function formatFromArgv(argv: readonly string[], isTty: boolean): OutputFormat {
  let explicit: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--format') { explicit = argv[i + 1]; i++; }
    else if (a.startsWith('--format=')) explicit = a.slice('--format='.length);
    else if (GLOBAL_FLAGS_WITH_VALUE.has(a)) i++; // skip the value: `--token --format` is a token, not a format
  }
  try {
    return resolveFormat({ explicit, isTty });
  } catch {
    return isTty ? 'table' : 'json';
  }
}
