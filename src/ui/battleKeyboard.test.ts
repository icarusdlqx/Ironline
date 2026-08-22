import { afterEach, describe, expect, it } from 'vitest';
import { battleModalOpen, shouldIgnoreBattleKey } from './battleKeyboard';
import { setTrainingPresentationStep } from './trainingPresentation';

const context = {
  briefingSeen: true,
  finished: false,
  interactiveTarget: false,
  code: 'Space',
  repeat: false,
};

describe('battle keyboard gate', () => {
  afterEach(() => setTrainingPresentationStep(null));

  it('holds every battle shortcut behind deployment', () => {
    expect(shouldIgnoreBattleKey({ ...context, briefingSeen: false })).toBe(true);
  });

  it('holds every battle shortcut behind the result report', () => {
    expect(shouldIgnoreBattleKey({ ...context, finished: true })).toBe(true);
  });

  it('leaves focused controls and editors to the browser', () => {
    expect(shouldIgnoreBattleKey({ ...context, interactiveTarget: true })).toBe(true);
  });

  it('recognises an open modal even when its replaced control loses focus', () => {
    const root = { querySelector: () => ({}) } as unknown as Document;
    expect(battleModalOpen(root)).toBe(true);
    expect(battleModalOpen({ querySelector: () => null } as unknown as Document)).toBe(false);
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

  it('holds untaught orders behind the current training step', () => {
    setTrainingPresentationStep(1);
    expect(shouldIgnoreBattleKey({ ...context, code: 'KeyF' })).toBe(true);
    expect(shouldIgnoreBattleKey({ ...context, code: 'KeyM' })).toBe(false);
  });
});
