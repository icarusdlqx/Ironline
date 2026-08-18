import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { createWorld, toResult } from '../sim/world';
import { resultWithBattleCode } from './battleCode';

describe('interactive battle result seed', () => {
  it('reports the opening code after the battle stream advances', () => {
    const seed = 'copper-relay-0000002a';
    const world = createWorld(catalog, {
      seed,
      missionId: 'skirmish_ridge',
      playerTeam: 0,
    });
    for (let draw = 0; draw < 12; draw += 1) world.rng.nextUint32();
    const live = toResult(world, String(world.rng.save().w), 200);

    expect(resultWithBattleCode(live, seed).seed).toBe(seed);
    expect(live.seed).not.toBe(seed);
  });
});
