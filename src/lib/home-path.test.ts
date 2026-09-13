import { describe, it, expect } from 'bun:test';
import { homePath } from './home-path.js';

describe('homePath (#130)', () => {
  it('replaces the home directory prefix with ~', () => {
    expect(homePath('/Users/x/.oura-cli/oura.db', '/Users/x')).toBe('~/.oura-cli/oura.db');
  });

  it('leaves a path outside the home directory alone, including one that merely starts with the same letters', () => {
    expect(homePath('/tmp/oura.db', '/Users/x')).toBe('/tmp/oura.db');
    expect(homePath('/Users/xy/oura.db', '/Users/x')).toBe('/Users/xy/oura.db');
    expect(homePath(':memory:', '/Users/x')).toBe(':memory:');
  });

  it('changes nothing when the home directory is unknown', () => {
    expect(homePath('/Users/x/oura.db', '')).toBe('/Users/x/oura.db');
  });

  it('prints the home directory itself as ~', () => {
    expect(homePath('/Users/x', '/Users/x')).toBe('~');
  });
});
