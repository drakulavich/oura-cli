export const GLOBAL_FLAGS_WITH_VALUE = new Set(['--format', '--token', '--db', '--tz']);
const GLOBAL_FLAGS_BOOLEAN = new Set(['--no-color']);
export const SUBCOMMANDS = new Set([
  'login', 'describe', 'healthcheck', 'doctor', 'manifest',
  'fetch', 'sync', 'db', 'report',
]);

/**
 * citty parses args per-command and root-level args don't reach subcommands.
 * This normaliser moves any global flag appearing BEFORE the subcommand name
 * to AFTER it, so citty receives them in the subcommand context.
 *
 * Example: ['bun', 'script', '--format', 'json', 'fetch', 'sleep']
 *       → ['bun', 'script', 'fetch', 'sleep', '--format', 'json']
 */
export function normalizeArgv(argv: string[]): string[] {
  const [bun, script, ...rest] = argv;
  const subIdx = rest.findIndex(a => SUBCOMMANDS.has(a));
  if (subIdx < 0) return argv; // no subcommand — nothing to hoist

  const before = rest.slice(0, subIdx);
  const subcommandOnwards = rest.slice(subIdx);

  const hoisted: string[] = [];
  const leftover: string[] = [];

  for (let i = 0; i < before.length; i++) {
    const tok = before[i];

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
      if (i + 1 < before.length) {
        hoisted.push(before[i + 1]);
        i++;
      }
      continue;
    }

    if (GLOBAL_FLAGS_BOOLEAN.has(tok)) {
      hoisted.push(tok);
      continue;
    }

    leftover.push(tok);
  }

  // Keep hoisted flags before a `--` separator; after it mri would read them as positionals.
  const dd = subcommandOnwards.indexOf('--');
  if (dd >= 0) {
    return [bun, script, ...leftover, ...subcommandOnwards.slice(0, dd), ...hoisted, ...subcommandOnwards.slice(dd)];
  }
  return [bun, script, ...leftover, ...subcommandOnwards, ...hoisted];
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
