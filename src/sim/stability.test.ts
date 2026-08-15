import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, spawnDesign, testWorld, unitOf } from '../../tests/support';
import { eventsOfType } from './events';
import { addStabilityImpulse, impulseOf, updateStability } from './stability';
import { isDown, isStaggered, type MechEntity, type World } from './types';

const rules = catalog.rules.stability;

let world: World;
let mech: MechEntity;

/** Enough shove to cross a threshold in one go, before resistance is applied. */
function shove(amount: number): void {
  addStabilityImpulse(world, mech, amount);
}

/** Runs the decay loop for `seconds`, the way stepWorld would. */
function settle(seconds: number): void {
  for (let tick = 0; tick < Math.round(seconds / world.dt); tick += 1) {
    world.tick += 1;
    updateStability(world, mech);
  }
}

beforeEach(() => {
  world = testWorld('stability');
  mech = unitOf(world, 'bulwark_assault');
});

describe('impulse', () => {
  it('ignores anything that only scratches the paint', () => {
    const lrm = catalog.weapons.get('lrm20');
    expect(lrm).toBeDefined();
    if (lrm === undefined) return;

    // A twenty-tube volley is twenty separate small impacts, and each of them
    // is under the floor. A missile boat cannot floor anything.
    expect(impulseOf(rules, lrm.damage, lrm)).toBe(0);
  });

  it('counts a heavy autocannon for more than its damage', () => {
    const ac20 = catalog.weapons.get('ac20');
    const ppc = catalog.weapons.get('ppc');
    expect(ac20).toBeDefined();
    expect(ppc).toBeDefined();
    if (ac20 === undefined || ppc === undefined) return;

    // The PPC has no recoil at all, so it shoves exactly what it burns through.
    expect(impulseOf(rules, ppc.damage, ppc)).toBeCloseTo(ppc.damage - rules.impactFloor, 6);
    // The autocannon shoves far harder than the damage alone would say.
    expect(impulseOf(rules, ac20.damage, ac20)).toBeGreaterThan(ac20.damage - rules.impactFloor);
  });
});

describe('staggering', () => {
  it('never floors a steady mech in one hit, however hard', () => {
    shove(10_000);

    expect(isDown(mech)).toBe(false);
    expect(isStaggered(mech, rules.staggerThreshold)).toBe(true);
    expect(eventsOfType(world.events, 'staggered')).toHaveLength(1);
  });

  it('floors a mech already staggered when the next big hit lands', () => {
    shove(10_000);
    shove(10_000);

    expect(isDown(mech)).toBe(true);
    expect(eventsOfType(world.events, 'knocked_down')).toHaveLength(1);
  });

  it('steadies itself if nothing follows up', () => {
    shove(10_000);
    expect(isStaggered(mech, rules.staggerThreshold)).toBe(true);

    settle(rules.knockdownThreshold / rules.recoveryPerSecond + 1);
    expect(mech.stability).toBe(0);
    expect(isStaggered(mech, rules.staggerThreshold)).toBe(false);
  });

  it('takes more to shift an assault than a light', () => {
    const heavy = spawnDesign(world, 'colossus_siege');
    expect(heavy.tonnage).toBeGreaterThan(mech.tonnage);

    addStabilityImpulse(world, mech, 20);
    addStabilityImpulse(world, heavy, 20);
    expect(heavy.stability).toBeLessThan(mech.stability);
  });
});

describe('being down', () => {
  it('gets back up, on its feet and steady', () => {
    shove(10_000);
    shove(10_000);
    expect(isDown(mech)).toBe(true);

    settle(rules.downSeconds + 1);
    expect(isDown(mech)).toBe(false);
    // Standing clears the pool. Carrying it over is what would make a mech that
    // never gets up again.
    expect(mech.stability).toBe(0);
    expect(eventsOfType(world.events, 'stood_up')).toHaveLength(1);
  });

  it('cannot be shoved while down, or in the moment after standing', () => {
    shove(10_000);
    shove(10_000);

    shove(10_000);
    expect(eventsOfType(world.events, 'knocked_down')).toHaveLength(1);

    settle(rules.downSeconds + 1);
    shove(10_000);
    expect(isStaggered(mech, rules.staggerThreshold)).toBe(false);

    // Once the footing runs out it is fair game again.
    settle(rules.footingSeconds + 1);
    shove(10_000);
    expect(isStaggered(mech, rules.staggerThreshold)).toBe(true);
  });

  it('cannot be shoved out of the air', () => {
    mech.jump = {
      from: { x: mech.pos.x, y: mech.pos.y },
      to: { x: mech.pos.x + 50, y: mech.pos.y },
      elapsed: 0,
      duration: 2,
    };

    shove(10_000);
    expect(mech.stability).toBe(0);
  });
});
