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
