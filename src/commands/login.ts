import { Command } from 'commander';
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

export function loginCommand(): Command {
  return new Command('login')
    .description('Save an Oura Personal Access Token for future commands.')
    .option('--token <pat>', 'Pass token non-interactively (e.g. for scripts)')
    .option(
      '--path <file>',
      'Where to save the token (default: $OURA_TOKEN_PATH or ~/.oura-token)',
    )
    .action(async (opts) => {
      const target = opts.path
        ?? process.env.OURA_TOKEN_PATH
        ?? resolve(homedir(), '.oura-token');

      let token = opts.token;
      if (!token) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        console.log('Get a Personal Access Token at https://cloud.ouraring.com/personal-access-tokens');
        token = await rl.question('Paste your token: ');
        rl.close();
      }

      writeToken(target, token);
      console.log(chalk.green(`Saved to ${target}`));
    });
}
