import { describe, expect, it } from 'vitest';
import { firstDropInstruction, firstDropStage } from './firstDropGuide';

describe('first drop guidance', () => {
  it.each([
    [{ outcomeCount: 0, finished: false, contractActive: false, prep: null }, 'choose'],
    [{ outcomeCount: 0, finished: false, contractActive: true, prep: null }, 'prepare'],
    [{ outcomeCount: 0, finished: false, contractActive: true, prep: 'bay' }, 'bay'],
    [{ outcomeCount: 0, finished: false, contractActive: true, prep: 'manifest' }, 'manifest'],
    [{ outcomeCount: 1, finished: false, contractActive: false, prep: null }, 'done'],
    [{ outcomeCount: 0, finished: true, contractActive: true, prep: 'bay' }, 'done'],
  ] as const)('derives %s as %s', (state, expected) => {
    expect(firstDropStage(state)).toBe(expected);
  });

  it('keeps every active stage actionable and the completed stage silent', () => {
    for (const stage of ['choose', 'prepare', 'bay', 'manifest'] as const) {
      expect(firstDropInstruction(stage)).toBeTruthy();
    }
    expect(firstDropInstruction('done')).toBeNull();
  });
});
