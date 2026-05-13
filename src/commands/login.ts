import { defineCommand } from 'citty';
import { writeFileSync, chmodSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline/promises';
import chalk from 'chalk';
import { CliError } from '../lib/errors.js';

export function writeToken(path: string, token: string): void {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new CliError('BAD_ARGS', 'Token cannot be empty.');
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, trimmed, { encoding: 'utf-8' });
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
  }
}

export const loginCommand = defineCommand({
  meta: { name: 'login', description: 'Save an Oura Personal Access Token for future commands.' },
  args: {
    token:      { type: 'string',  description: 'Pass token non-interactively (e.g. for scripts)' },
    path:       { type: 'string',  description: 'Where to save the token (default: $OURA_TOKEN_PATH or ~/.oura-token)' },
    'no-color': { type: 'boolean', default: false, description: 'Disable ANSI colors (also honors NO_COLOR env)' },
  },
  async run({ args }) {
    if (args['no-color'] || process.env.NO_COLOR) {
      const { default: chk } = await import('chalk');
      chk.level = 0;
    }
    const target = args.path ?? process.env.OURA_TOKEN_PATH ?? resolve(homedir(), '.oura-token');
    let token = args.token as string | undefined;
    if (!token) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      console.log('Get a Personal Access Token at https://cloud.ouraring.com/personal-access-tokens');
      token = await rl.question('Paste your token: ');
      rl.close();
    }
    writeToken(target, token);
    console.log(chalk.green(`Saved to ${target}`));
  },
});
