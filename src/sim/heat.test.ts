import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, testWorld, unitOf } from '../../tests/support';
import { resolveProjectiles } from './combat';
import { eventsOfType } from './events';
import { addHeat, currentHeatTier, heatTierFor, updateHeat } from './heat';
import type { MechEntity, World } from './types';

let world: World;
let mech: MechEntity;

beforeEach(() => {
  world = testWorld('heat');
  mech = unitOf(world, 'bulwark_burner');
});

describe('heatTierFor', () => {
  const rules = testWorld('tiers').rules.heat;

  it('picks the highest tier at or below the current fraction', () => {
    expect(heatTierFor(rules, 0).fraction).toBe(0);
    expect(heatTierFor(rules, 0.6).fraction).toBe(0.5);
    expect(heatTierFor(rules, 0.86).fraction).toBe(0.85);
    expect(heatTierFor(rules, 1.4).fraction).toBe(1);
  });

  it('degrades accuracy and movement as heat climbs', () => {
    expect(heatTierFor(rules, 0).accuracyFactor).toBe(1);
    expect(heatTierFor(rules, 0.75).accuracyFactor).toBeLessThan(1);
    expect(heatTierFor(rules, 0.55).movementFactor).toBeLessThan(1);
  });
});

describe('updateHeat', () => {
  it('dissipates heat over a tick', () => {
    addHeat(mech, 20);
    updateHeat(world, mech);
    expect(mech.heat).toBeCloseTo(20 - mech.dissipationPerSecond * world.dt, 6);
  });

  it('never dissipates below zero', () => {
    addHeat(mech, 0.001);
    updateHeat(world, mech);
    expect(mech.heat).toBe(0);
  });

  it('records the peak heat reached', () => {
    addHeat(mech, 25);
    addHeat(mech, -10);
    expect(mech.stats.heatPeak).toBe(25);
  });

  it('doubles dissipation in water', () => {
    const dry = { x: 12, y: 12 };
    const wet = { x: 18 * 24 + 12, y: 33 * 24 + 12 };
    expect(world.terrain.typeAtPoint(dry).heatDissipationMultiplier).toBe(1);
    expect(world.terrain.typeAtPoint(wet).heatDissipationMultiplier).toBe(2);

    mech.pos = dry;
    mech.heat = 20;
    updateHeat(world, mech);
    const dryLoss = 20 - mech.heat;

    mech.pos = wet;
    mech.heat = 20;
    updateHeat(world, mech);
    const wetLoss = 20 - mech.heat;

    expect(dryLoss).toBeGreaterThan(0);
    expect(wetLoss).toBeCloseTo(dryLoss * 2, 6);
  });

  it('forces a shutdown at full heat', () => {
    addHeat(mech, mech.heatCapacity * 1.2);
    updateHeat(world, mech);

    expect(mech.shutdownRemaining).toBe(world.rules.heat.shutdownSeconds);
    const shutdowns = eventsOfType(world.events, 'shutdown');
    expect(shutdowns.at(-1)?.forced).toBe(true);
  });

  it('restarts once the shutdown timer expires', () => {
    addHeat(mech, mech.heatCapacity * 1.2);
    updateHeat(world, mech);

    mech.heat = 0;
    for (let tick = 0; tick < world.rules.heat.shutdownSeconds / world.dt + 2; tick += 1) {
      updateHeat(world, mech);
    }

    expect(mech.shutdownRemaining).toBe(0);
    expect(eventsOfType(world.events, 'restart').length).toBe(1);
  });

  it('leaves a cool mech alone', () => {
    updateHeat(world, mech);
    expect(mech.shutdownRemaining).toBe(0);
    expect(currentHeatTier(world, mech).fraction).toBe(0);
    expect(eventsOfType(world.events, 'shutdown')).toHaveLength(0);
  });
});

describe('flamers', () => {
  it('dumps heat into whatever it hits', () => {
    const flamer = catalog.weapons.get('flamer');
    expect(flamer).toBeDefined();
    if (flamer === undefined) return;
    expect(flamer.targetHeat).toBeGreaterThan(0);

    const shooter = unitOf(world, 'sentinel_brawler');
    const target = unitOf(world, 'bulwark_burner');
    target.pos = { x: shooter.pos.x + 20, y: shooter.pos.y };
    target.heat = 0;

    world.projectiles = [
      {
        shooterId: shooter.id,
        targetId: target.id,
        weaponId: 'flamer',
        hit: true,
        from: { x: target.pos.x + 100, y: target.pos.y },
        calledShot: null,
        damage: flamer.damage,
        impactTick: world.tick,
      },
    ];
    resolveProjectiles(world);

    expect(target.heat).toBe(flamer.targetHeat);
  });

  it('leaves the target cold when an ordinary weapon lands', () => {
    const shooter = unitOf(world, 'sentinel_brawler');
    const target = unitOf(world, 'bulwark_burner');
    target.heat = 0;

    world.projectiles = [
      {
        shooterId: shooter.id,
        targetId: target.id,
        weaponId: 'medium_laser',
        hit: true,
        from: { x: target.pos.x + 100, y: target.pos.y },
        calledShot: null,
        damage: 5,
        impactTick: world.tick,
      },
    ];
    resolveProjectiles(world);

    expect(target.heat).toBe(0);
  });
});
