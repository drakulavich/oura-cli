export const GLOBAL_FLAGS_WITH_VALUE = new Set(['--format', '--token', '--db', '--tz']);
const GLOBAL_FLAGS_BOOLEAN = new Set(['--no-color']);
export const SUBCOMMANDS = new Set([
  'login', 'describe', 'healthcheck', 'doctor', 'manifest',
  'fetch', 'sync', 'db', 'report',
]);

/**
 * citty parses args per-command, and root-level args do not reach subcommands: it also resolves
 * a subcommand by the first non-flag token it sees, so a flag's *value* sitting between a command
 * and its subcommand is read as the subcommand name (`db --format json today` → Unknown command
 * "json"). This normaliser lifts every global flag, wherever it appears, to the end of the
 * command line, so citty sees only commands up front and the flags in the innermost context.
 *
 * Example: ['bun', 'script', 'db', '--format', 'json', 'today']
 *       → ['bun', 'script', 'db', 'today', '--format', 'json']
 *
 * Tokens after `--` are left alone: they are values, not flags.
 */
export function normalizeArgv(argv: string[]): string[] {
  const [bun, script, ...rest] = argv;
  const dd = rest.indexOf('--');
  const scanned = dd >= 0 ? rest.slice(0, dd) : rest;
  const passthrough = dd >= 0 ? rest.slice(dd) : [];

  const kept: string[] = [];
  const hoisted: string[] = [];

  for (let i = 0; i < scanned.length; i++) {
    const tok = scanned[i]!;

    // Handle --flag=value form
    if (tok.includes('=')) {
      const name = tok.slice(0, tok.indexOf('='));
      if (GLOBAL_FLAGS_WITH_VALUE.has(name) || GLOBAL_FLAGS_BOOLEAN.has(name)) {
        hoisted.push(tok);
        continue;
      }
    }

    // Handle --flag value form
    if (GLOBAL_FLAGS_WITH_VALUE.has(tok)) {
      hoisted.push(tok);
      if (i + 1 < scanned.length) {
        hoisted.push(scanned[i + 1]!);
        i++;
      }
      continue;
    }

    if (GLOBAL_FLAGS_BOOLEAN.has(tok)) {
      hoisted.push(tok);
      continue;
    }

    kept.push(tok);
  }

  // Hoisted flags stay before `--`; after it mri would read them as positionals.
  return [bun, script, ...kept, ...hoisted, ...passthrough];
}

/**
 * True when the user asked for the version: `--version`/`-v` appearing before any subcommand
 * and not in the value position of a value-taking global flag (`--db --version` is a bad
 * --db value, not a version request). citty itself only answers when it is the sole argument.
 */
export function isVersionRequest(rawArgs: readonly string[]): boolean {
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i]!;
    if (SUBCOMMANDS.has(tok)) return false;
    if (GLOBAL_FLAGS_WITH_VALUE.has(tok)) { i++; continue; }
    if (tok === '--version' || tok === '-v') return true;
  }
  return false;
}
