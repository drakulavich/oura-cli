import chalk from 'chalk';

export type ErrorCode =
  | 'BAD_ARGS'
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'API_ERROR'
  | 'DB_ERROR'
  | string;

export class CliError extends Error {
  constructor(public code: ErrorCode, message: string, public hint?: string) {
    super(message);
    this.name = 'CliError';
  }
}

export interface ErrorEnvelope {
  kind: 'json' | 'text';
  text: string;
}

const EXIT_CODE_BY_CODE: Record<string, number> = {
  BAD_ARGS: 1,
  TOKEN_MISSING: 2,
  TOKEN_INVALID: 2,
  API_ERROR: 3,
  DB_ERROR: 4,
};

export function exitCodeFor(err: unknown): number {
  if (err instanceof CliError) return EXIT_CODE_BY_CODE[err.code] ?? 1;
  return 1;
}

export function formatError(err: unknown, format: 'json' | 'table'): ErrorEnvelope {
  const code = err instanceof CliError ? err.code : 'UNKNOWN';
  const message = err instanceof Error ? err.message : String(err);
  const hint = err instanceof CliError ? err.hint : undefined;

  if (format === 'json') {
    return {
      kind: 'json',
      text: JSON.stringify({ error: { code, message, ...(hint ? { hint } : {}) } }),
    };
  }

  const head = chalk.red(`error: ${message}`);
  return { kind: 'text', text: hint ? `${head}\n  hint: ${hint}` : head };
}

export function emitError(err: unknown, format: 'json' | 'table'): void {
  const env = formatError(err, format);
  process.stderr.write(env.text + '\n');
}
