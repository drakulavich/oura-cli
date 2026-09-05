import { CliError } from './errors.js';

export type OutputFormat = 'table' | 'json';

export interface ResolveFormatArgs {
  explicit: string | undefined;
  isTty: boolean;
}

export function resolveFormat({ explicit, isTty }: ResolveFormatArgs): OutputFormat {
  if (explicit === undefined) return isTty ? 'table' : 'json';
  if (explicit === 'table' || explicit === 'json') return explicit;
  throw new CliError(
    'BAD_ARGS',
    `Unknown --format value: "${explicit}". Use "table" or "json".`,
  );
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
    if (a === '--format') explicit = argv[i + 1];
    else if (a.startsWith('--format=')) explicit = a.slice('--format='.length);
  }
  try {
    return resolveFormat({ explicit, isTty });
  } catch {
    return isTty ? 'table' : 'json';
  }
}
