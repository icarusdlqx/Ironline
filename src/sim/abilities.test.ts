import { describe, expect, it } from 'vitest';
import { catalog, playerWorld } from '../../tests/support';
import { abilityFactor, abilityIdFor, abilityReady, useAbility } from './abilities';
import { issueAlphaStrike } from './orders';
import type { MechEntity, World } from './types';
import { stepWorld } from './world';

function mine(world: World): MechEntity {
  const entity = world.entities.find((candidate) => candidate.team === 0);
  if (entity === undefined) throw new Error('no player mech');
  return entity;
}

describe('what a pilot can do', () => {
  it('gives every pilot an ability, and the specialists their own', () => {
    const rules = catalog.rules.abilities;
    expect(abilityIdFor(rules, [])).toBe(rules.default);
    expect(abilityIdFor(rules, ['marksman'])).toBe('aimed_volley');
    expect(abilityIdFor(rules, ['spotter'])).toBe('sensor_sweep');
    // An unknown speciality is not a reason to have no button at all.
    expect(rules.entries[abilityIdFor(rules, ['nonsense_trait'])]).toBeDefined();
  });

  it('spends on use, works for its duration, and goes on cooldown', () => {
    const world = playerWorld('ability');
    const mech = mine(world);
    mech.ability.id = 'aimed_volley';

    expect(abilityReady(world, mech)).toBe(true);
    expect(abilityFactor(world, mech, 'accuracy')).toBe(1);

    expect(useAbility(world, mech)).toBe(true);
    expect(abilityFactor(world, mech, 'accuracy')).toBeGreaterThan(1);
    // Not twice in a row: the cooldown is the whole cost of the thing.
    expect(useAbility(world, mech)).toBe(false);

    const duration = catalog.rules.abilities.entries.aimed_volley?.durationSeconds ?? 0;
    for (let tick = 0; tick <= Math.ceil(duration / world.dt) + 1; tick += 1) {
      stepWorld(world, 12_000);
    }
    expect(abilityFactor(world, mech, 'accuracy')).toBe(1);
    expect(abilityReady(world, mech)).toBe(false);
  });

  it('sheds heat on the spot for an instant ability', () => {
    const world = playerWorld('coolant');
    const mech = mine(world);
    mech.ability.id = 'coolant_flush';
    mech.heat = mech.heatCapacity * 0.9;
    const before = mech.heat;

    expect(useAbility(world, mech)).toBe(true);
    expect(mech.heat).toBeLessThan(before * 0.6);
  });

  it('is not available to a mech that is shut down or on the ground', () => {
    const world = playerWorld('unavailable');
    const mech = mine(world);
    mech.shutdownRemaining = 3;
    expect(abilityReady(world, mech)).toBe(false);
    expect(useAbility(world, mech)).toBe(false);
  });
});

describe('alpha strike', () => {
  it('opens the heat gate for a moment, then closes it', () => {
    const world = playerWorld('alpha');
    const mech = mine(world);

    expect(issueAlphaStrike(world, mech)).toBe(true);
    expect(world.tick).toBeLessThanOrEqual(mech.alphaUntilTick);
    // One at a time: the cooldown is what stops it being the only tactic.
    expect(issueAlphaStrike(world, mech)).toBe(false);

    const window = catalog.rules.heat.alphaStrikeSeconds;
    for (let tick = 0; tick <= Math.ceil(window / world.dt) + 1; tick += 1) {
      stepWorld(world, 12_000);
    }
    expect(world.tick).toBeGreaterThan(mech.alphaUntilTick);
  });

  it('un-holds the guns so the volley actually leaves', () => {
    const world = playerWorld('alpha-hold');
    const mech = mine(world);
    for (let group = 0; group < mech.groupIntent.length; group += 1) {
      mech.groupIntent[group] = false;
      mech.groupEnabled[group] = false;
    }

    expect(issueAlphaStrike(world, mech)).toBe(true);
    expect(mech.groupEnabled.some((on) => on)).toBe(true);
  });

  it('can cook a mech past its own capacity, which is the gamble', () => {
    const world = playerWorld('alpha-heat');
    const mech = mine(world);
    // Firing everything from a hot start is exactly the risk being sold.
    mech.heat = mech.heatCapacity * 0.8;
    expect(issueAlphaStrike(world, mech)).toBe(true);
    expect(mech.alphaUntilTick).toBeGreaterThan(world.tick);
  });
});
