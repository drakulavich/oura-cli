import { describe, it, expect } from 'bun:test';
import { shouldDisableColor } from './color-mode.js';

// #80: `--no-color` reached chalk but not citty's usage renderer, which reads NO_COLOR when its
// module is evaluated. The rule is tested here; `src/lib/apply-color-mode.ts` applies it, and
// `src/no-color.test.ts` checks the real CLI end to end.
describe('shouldDisableColor', () => {
  it('disables colour when --no-color is passed, even on a terminal', () => {
    expect(shouldDisableColor(['--no-color'], {}, true)).toBe(true);
  });

  it('disables colour when NO_COLOR is set, even on a terminal', () => {
    expect(shouldDisableColor([], { NO_COLOR: '1' }, true)).toBe(true);
  });

  it('disables colour for piped output', () => {
    expect(shouldDisableColor([], {}, false)).toBe(true);
  });

  it('keeps colour on a terminal', () => {
    expect(shouldDisableColor([], {}, true)).toBe(false);
  });

  it('keeps colour when FORCE_COLOR asks for it on a pipe, so `| less -R` still works', () => {
    expect(shouldDisableColor([], { FORCE_COLOR: '1' }, false)).toBe(false);
  });

  it.each([['0'], ['false'], ['']])('treats FORCE_COLOR=%j as off, the way chalk does', value => {
    // Otherwise chalk goes plain while citty keeps its escapes, and one screen has both.
    expect(shouldDisableColor([], { FORCE_COLOR: value }, false)).toBe(true);
  });

  it('lets an explicit --no-color win over FORCE_COLOR', () => {
    expect(shouldDisableColor(['--no-color'], { FORCE_COLOR: '1' }, false)).toBe(true);
  });
});
