import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import {
  difficultyChoices,
  engineSetupFor,
  isBattleSetupLocked,
  setupForNewField,
  type BattleSetupKey,
} from './battleSetupState';

describe('battle setup lifecycle', () => {
  const draft: BattleSetupKey = {
    missionId: 'base_capture_ridge',
    difficulty: 'elite',
    lanceKey: 'new-lance',
    battleCode: 'new-field',
  };
  const deployed: BattleSetupKey = {
    missionId: 'skirmish_ridge',
    difficulty: 'green',
    lanceKey: 'fielded-lance',
    battleCode: 'held-field',
  };

  it('keeps the deployed inputs when the setup draft changes', () => {
    expect(engineSetupFor(draft, deployed)).toBe(deployed);
    expect(engineSetupFor(draft, null)).toBe(draft);
  });

  it('changes only the code for a new field', () => {
    expect(setupForNewField(deployed, 'fresh-field')).toEqual({
      ...deployed,
      battleCode: 'fresh-field',
    });
    expect(engineSetupFor(draft, deployed).battleCode).toBe('held-field');
  });

  it('locks a live battle and an unresolved campaign result', () => {
    expect(isBattleSetupLocked(false, false, false)).toBe(false);
    expect(isBattleSetupLocked(true, false, false)).toBe(true);
    expect(isBattleSetupLocked(true, true, false)).toBe(false);
    expect(isBattleSetupLocked(true, true, true)).toBe(true);
  });
});

describe('difficulty descriptions', () => {
  const choices = difficultyChoices(catalog.rules.difficulty);
  const description = (id: string): string =>
    choices.find((choice) => choice.id === id)?.description ?? '';

  it('states the behaviour each tier actually enables', () => {
    expect(description('green')).toMatch(/less accurate.*cautiously.*independently/s);
    expect(description('regular')).toMatch(/normal accuracy.*focus damaged targets.*seek cover/s);
    expect(description('veteran')).toMatch(/more accurate.*flank exposed mechs.*vulnerable sections/s);
    expect(description('elite')).toMatch(/highly accurate.*press attacks/s);
  });

  it('does not promise the unused lance-size setting', () => {
    expect(choices.map((choice) => choice.description).join(' ')).not.toMatch(
      /more enemies|fewer enemies|extra enemy|lance size/i,
    );
  });
});
