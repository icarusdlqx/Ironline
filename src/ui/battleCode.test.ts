import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import { createWorld } from '../sim/world';
import {
  checkBattleCode,
  createBattleCode,
  createNewBattleCode,
  initialBattleCode,
  TRAINING_BATTLE_CODE,
} from './battleCode';
import { TRAINING_MISSION_ID } from './trainingProgress';

describe('battle codes', () => {
  it('normalises readable separators and case through one check', () => {
    expect(checkBattleCode('  Copper__Relay---02A  ')).toEqual({
      ok: true,
      code: 'copper-relay-02a',
      reason: null,
    });
  });

  it('rejects empty, malformed, and oversized codes', () => {
    expect(checkBattleCode(' ').ok).toBe(false);
    expect(checkBattleCode('bad/code').ok).toBe(false);
    expect(checkBattleCode('x'.repeat(49)).ok).toBe(false);
  });

  it('uses injected generation but keeps training deterministic', () => {
    expect(createBattleCode(() => 'ASHEN Yard 0000002A')).toBe('ashen-yard-0000002a');
    const generate = vi.fn(() => 'new-field-00000001');
    expect(initialBattleCode(TRAINING_MISSION_ID, generate)).toBe(TRAINING_BATTLE_CODE);
    expect(generate).not.toHaveBeenCalled();
    expect(initialBattleCode('skirmish_ridge', generate)).toBe('new-field-00000001');
  });

  it('draws again rather than calling the same field new', () => {
    const generate = vi
      .fn<() => string>()
      .mockReturnValueOnce('held-field')
      .mockReturnValueOnce('fresh-field');

    expect(createNewBattleCode('held-field', generate)).toBe('fresh-field');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('gives the same code the same opening world', () => {
    const seed = checkBattleCode('Copper Relay 02A');
    if (!seed.ok) throw new Error(seed.reason);
    const create = () =>
      createWorld(catalog, {
        seed: seed.code,
        missionId: 'skirmish_ridge',
        playerTeam: 0,
        difficulty: 'regular',
      });
    const first = create();
    const second = create();

    expect(second.rng.save()).toEqual(first.rng.save());
    expect(second.entities.map(({ id, pos, facing }) => ({ id, pos, facing }))).toEqual(
      first.entities.map(({ id, pos, facing }) => ({ id, pos, facing })),
    );
    expect(
      createWorld(catalog, {
        seed: 'different-field-02a',
        missionId: 'skirmish_ridge',
        playerTeam: 0,
        difficulty: 'regular',
      }).rng.save(),
    ).not.toEqual(first.rng.save());
  });
});
