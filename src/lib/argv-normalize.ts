const GLOBAL_FLAGS_WITH_VALUE = new Set(['--format', '--token', '--db', '--tz']);
const GLOBAL_FLAGS_BOOLEAN = new Set(['--no-color']);
const SUBCOMMANDS = new Set([
  'login', 'describe', 'healthcheck', 'doctor', 'manifest',
  'fetch', 'sync', 'db', 'report',
]);

/**
 * citty parses args per-command and root-level args don't reach subcommands.
 * This normaliser moves any global flag appearing BEFORE the subcommand name
 * to AFTER it, so citty receives them in the subcommand context.
 *
 * Example: ['bun', 'script', '--format', 'json', 'sleep', 'today']
 *       → ['bun', 'script', 'sleep', 'today', '--format', 'json']
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

  return [bun, script, ...leftover, ...subcommandOnwards, ...hoisted];
}
