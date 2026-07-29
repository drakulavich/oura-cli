import { describe, it, expect, afterEach } from 'bun:test';
import { EventEmitter } from 'events';
import { readFileSync, statSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { readHiddenToken, writeToken } from './login.js';

const tmpPath = resolve(tmpdir(), `oura-token-test-${process.pid}-${Math.random().toString(36).slice(2)}`);

afterEach(() => {
  try { rmSync(tmpPath, { force: true }); } catch {}
});

describe('writeToken', () => {
  describe('when given a valid token', () => {
    it('persists the token to the configured file path so future commands can read it', () => {
      writeToken(tmpPath, 'abc-123');

      expect(readFileSync(tmpPath, 'utf-8')).toBe('abc-123');
    });

    it('saves the token with owner-only permissions on POSIX so other users on the same host cannot read it', () => {
      if (process.platform === 'win32') return;

      writeToken(tmpPath, 'abc-123');

      const mode = statSync(tmpPath).mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('when given an empty or whitespace-only token', () => {
    it('throws an error explaining the token cannot be empty', () => {
      expect(() => writeToken(tmpPath, '   ')).toThrow(/empty/i);
    });
  });
});

describe('readHiddenToken', () => {
  it('collects a token without writing it to terminal output', async () => {
    class FakeTerminalInput extends EventEmitter {
      isTTY = true;
      rawModes: boolean[] = [];
      paused = false;

      setRawMode(mode: boolean) { this.rawModes.push(mode); }
      resume() {}
      pause() { this.paused = true; }
    }
    const input = new FakeTerminalInput();
    let terminalOutput = '';
    const output = { write(text: string) { terminalOutput += text; return true; } };

    const token = readHiddenToken(input, output);
    input.emit('data', Buffer.from('sensitive-personal-access-token\n'));

    expect(await token).toBe('sensitive-personal-access-token');
    expect(terminalOutput).not.toContain('sensitive-personal-access-token');
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
  });
});
