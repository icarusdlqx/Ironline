import { describe, expect, it } from 'vitest';
import { shouldIgnoreBattleKey } from './battleKeyboard';

const context = {
  briefingSeen: true,
  interactiveTarget: false,
  code: 'Space',
  repeat: false,
};

describe('battle keyboard gate', () => {
  it('holds every battle shortcut behind deployment', () => {
    expect(shouldIgnoreBattleKey({ ...context, briefingSeen: false })).toBe(true);
  });

  it('leaves focused controls and editors to the browser', () => {
    expect(shouldIgnoreBattleKey({ ...context, interactiveTarget: true })).toBe(true);
  });

  it('ignores key repeat for state toggles', () => {
    for (const code of ['Space', 'KeyH', 'KeyP', 'KeyT']) {
      expect(shouldIgnoreBattleKey({ ...context, code, repeat: true })).toBe(true);
    }
    expect(shouldIgnoreBattleKey({ ...context, code: 'Period', repeat: true })).toBe(false);
  });

  it('allows an ordinary deployed shortcut', () => {
    expect(shouldIgnoreBattleKey(context)).toBe(false);
  });
});
