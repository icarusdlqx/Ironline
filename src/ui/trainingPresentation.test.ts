import { describe, expect, it } from 'vitest';
import {
  battleStartsPaused,
  trainingCommandIds,
  trainingShortcutAllowed,
  trainingShowsContacts,
  trainingShowsFullHud,
  trainingShowsHeatReadout,
} from './trainingPresentation';

describe('training presentation', () => {
  it('pauses only the standalone range, never a campaign launched from stale range setup', () => {
    expect(battleStartsPaused(false, 'training_ground')).toBe(true);
    expect(battleStartsPaused(true, 'training_ground')).toBe(false);
    expect(battleStartsPaused(false, 'skirmish_ridge')).toBe(false);
  });

  it('adds only the commands taught by each lesson', () => {
    expect([...trainingCommandIds(0) ?? []]).toEqual([]);
    expect([...trainingCommandIds(1) ?? []]).toEqual(['move']);
    expect([...trainingCommandIds(2) ?? []]).toEqual(['move', 'attack']);
    expect([...trainingCommandIds(3) ?? []]).toEqual([
      'move',
      'attack',
      'hold_fire',
      'heat_safety',
    ]);
    expect(trainingCommandIds(4)).toBeNull();
    expect(trainingCommandIds(null)).toBeNull();
  });

  it('keeps camera, pause, and selection keys while gating untaught orders', () => {
    expect(trainingShortcutAllowed(0, 'ArrowDown')).toBe(true);
    expect(trainingShortcutAllowed(0, 'Space')).toBe(true);
    expect(trainingShortcutAllowed(0, 'Tab')).toBe(true);
    expect(trainingShortcutAllowed(0, 'KeyM')).toBe(false);
    expect(trainingShortcutAllowed(1, 'KeyM')).toBe(true);
    expect(trainingShortcutAllowed(1, 'KeyF')).toBe(false);
    expect(trainingShortcutAllowed(2, 'KeyF')).toBe(true);
    expect(trainingShortcutAllowed(2, 'KeyH')).toBe(false);
    expect(trainingShortcutAllowed(3, 'KeyH')).toBe(true);
    expect(trainingShortcutAllowed(3, 'KeyT')).toBe(true);
    expect(trainingShortcutAllowed(4, 'KeyX')).toBe(true);
    expect(trainingShortcutAllowed(null, 'KeyX')).toBe(true);
  });

  it('restores the complete interface for the range drill', () => {
    expect(trainingShowsContacts(1)).toBe(false);
    expect(trainingShowsContacts(2)).toBe(true);
    expect(trainingShowsHeatReadout(3)).toBe(true);
    expect(trainingShowsHeatReadout(4)).toBe(false);
    expect(trainingShowsFullHud(3)).toBe(false);
    expect(trainingShowsFullHud(4)).toBe(true);
  });
});
