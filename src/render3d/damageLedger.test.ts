import { describe, expect, it } from 'vitest';
import { testWorld, unitOf } from '../../tests/support';
import type { SimEvent } from '../sim/events';
import { DamageLedger, damageWearTier } from './damageLedger';

type Hit = Extract<SimEvent, { type: 'projectile_hit' }>;

function hit(targetId: number, damage: number, arc: Hit['arc'] = 'front'): Hit {
  return {
    type: 'projectile_hit',
    tick: 1,
    shooterId: 99,
    targetId,
    weaponId: 'medium_laser',
    location: 'centre_torso',
    damage,
    arc,
  };
}

describe('damage presentation ledger', () => {
  it('splits a penetrating hit between the plate and frame', () => {
    const world = testWorld('damage-ledger-split');
    const target = unitOf(world, 'sentinel_brawler');
    target.locations.centre_torso.armour = 4;
    target.locations.centre_torso.internal = 20;
    const ledger = new DamageLedger(world);

    expect(ledger.classify(world, hit(target.id, 11))).toEqual({
      armour: 4,
      structure: 7,
      known: true,
    });
  });

  it('reads the rear plate without spending the front plate', () => {
    const world = testWorld('damage-ledger-rear');
    const target = unitOf(world, 'sentinel_brawler');
    target.locations.centre_torso.armour = 30;
    target.locations.centre_torso.rearArmour = 3;
    target.locations.centre_torso.internal = 20;
    const ledger = new DamageLedger(world);

    expect(ledger.classify(world, hit(target.id, 8, 'rear'))).toEqual({
      armour: 3,
      structure: 5,
      known: true,
    });
    expect(ledger.classify(world, hit(target.id, 5))).toEqual({
      armour: 5,
      structure: 0,
      known: true,
    });
  });

  it('resyncs from the authoritative world between event batches', () => {
    const world = testWorld('damage-ledger-sync');
    const target = unitOf(world, 'sentinel_brawler');
    const ledger = new DamageLedger(world);
    target.locations.centre_torso.armour = 0;
    target.locations.centre_torso.internal = 12;
    ledger.sync(world);

    expect(ledger.classify(world, hit(target.id, 6))).toEqual({
      armour: 0,
      structure: 6,
      known: true,
    });
  });

  it('changes wear only at coarse damage thresholds', () => {
    const world = testWorld('damage-wear');
    const location = unitOf(world, 'sentinel_brawler').locations.centre_torso;
    const maximum = location.armourMax + location.rearArmourMax + location.internalMax;

    location.armour = maximum * 0.8;
    location.rearArmour = 0;
    location.internal = 0;
    expect(damageWearTier(location)).toBe(0);
    location.armour = maximum * 0.6;
    expect(damageWearTier(location)).toBe(1);
    location.armour = maximum * 0.2;
    expect(damageWearTier(location)).toBe(2);
  });
});
