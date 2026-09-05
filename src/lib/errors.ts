import chalk from 'chalk';

export type ErrorCode =
  | 'BAD_ARGS'
  | 'TOKEN_MISSING'
  | 'TOKEN_INVALID'
  | 'API_ERROR'
  | 'DB_ERROR'
  | 'UNKNOWN';

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

export function exitCodeFor(err: unknown): number {
  if (!(err instanceof CliError)) return 1;
  switch (err.code) {
    case 'BAD_ARGS':       return 1;
    case 'TOKEN_MISSING':
    case 'TOKEN_INVALID':  return 2;
    case 'API_ERROR':      return 3;
    case 'DB_ERROR':       return 4;
    case 'UNKNOWN':        return 1;
  }
}

export function redactSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/g, 'Bearer [REDACTED]')
    .replace(/"token"\s*:\s*"[^"]{8,}"/g, '"token":"[REDACTED]"');
}

export function formatError(err: unknown, format: 'json' | 'table'): ErrorEnvelope {
  const code = err instanceof CliError ? err.code : 'UNKNOWN';
  // Redact here as well as at the API boundary: an unexpected error (e.g. from fetch) may quote a header.
  const message = redactSecrets(err instanceof Error ? err.message : String(err));
  const hint = err instanceof CliError && err.hint ? redactSecrets(err.hint) : undefined;

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
