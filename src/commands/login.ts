import { defineCommand } from 'citty';
import { writeFileSync, chmodSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { CliError, emitError, exitCodeFor } from '../lib/errors.js';
import { commonArgs } from './common.js';

type HiddenTokenInput = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
  resume: () => void;
  pause: () => void;
  on: (event: 'data', listener: (chunk: Buffer) => void) => unknown;
  off: (event: 'data', listener: (chunk: Buffer) => void) => unknown;
};

type TerminalOutput = {
  write: (text: string) => boolean;
};

export async function readHiddenToken(input: HiddenTokenInput, output: TerminalOutput): Promise<string> {
  if (!input.isTTY || !input.setRawMode) {
    throw new CliError('BAD_ARGS', 'Interactive login requires a terminal.', 'Use `oura-cli login --token` for non-interactive use.');
  }

  output.write('Paste your token (input hidden): ');
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let token = '';
    const finish = () => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(token);
          return;
        }
        if (char === '\u0003' || char === '\u0004') {
          finish();
          reject(new CliError('BAD_ARGS', 'Login cancelled.'));
          return;
        }
        if (char === '\b' || char === '\u007f') {
          token = token.slice(0, -1);
        } else if (char >= ' ') {
          token += char;
        }
      }
    };
    input.on('data', onData);
  });
}

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
    'no-color': commonArgs['no-color'],
  },
  async run({ args }) {
    try {
      if (args['no-color'] || process.env.NO_COLOR) {
        const { default: chk } = await import('chalk');
        chk.level = 0;
      }
      const target = args.path ?? process.env.OURA_TOKEN_PATH ?? resolve(homedir(), '.oura-token');
      let token = args.token as string | undefined;
      if (!token) {
        console.log('Get a Personal Access Token at https://cloud.ouraring.com/personal-access-tokens');
        token = await readHiddenToken(process.stdin, process.stdout);
      }
      writeToken(target, token);
      console.log(chalk.green(`Saved to ${target}`));
    } catch (err) {
      emitError(err, 'table');
      process.exit(exitCodeFor(err));
    }
  },
});
