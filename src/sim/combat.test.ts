import { beforeEach, describe, expect, it } from 'vitest';
import { LOCATIONS } from '../schema/common';
import { testWorld, unitOf } from '../../tests/support';
import { hitChance, resolveProjectiles, updateWeapons } from './combat';
import { eventsOfType } from './events';
import { lineOfSight } from './los';
import type { MechEntity, World } from './types';

let world: World;
let shooter: MechEntity;
let target: MechEntity;

function weapon(id: string) {
  const found = world.catalog.weapons.get(id);
  if (found === undefined) throw new Error(`missing weapon ${id}`);
  return found;
}

/**
 * A point squarely off the target's nose. Incoming damage is multiplied by the
 * arc a shot arrives on, so any fixture asserting exact numbers has to say
 * which side of the mech it is shooting at.
 */
function offTheNose(of: MechEntity): { x: number; y: number } {
  return { x: of.pos.x + Math.cos(of.facing) * 100, y: of.pos.y + Math.sin(of.facing) * 100 };
}

beforeEach(() => {
  world = testWorld('combat');
  shooter = unitOf(world, 'bulwark_assault');
  target = unitOf(world, 'bulwark_burner');
  shooter.pos = { x: 500, y: 500 };
  target.pos = { x: 560, y: 500 };
  shooter.facing = 0;
  shooter.motion = 'stationary';
  target.motion = 'stationary';
});

describe('hitChance', () => {
  it('stays inside the rules floor and ceiling', () => {
    const rules = world.rules.combat;
    for (const range of [1, 50, 150, 400, 5000]) {
      const chance = hitChance(world, shooter, target, weapon('large_laser'), range);
      expect(chance).toBeGreaterThanOrEqual(rules.hitChanceFloor);
      expect(chance).toBeLessThanOrEqual(rules.hitChanceCeiling);
    }
  });

  it('falls off across the range bands', () => {
    const gun = weapon('ac5');
    const short = hitChance(world, shooter, target, gun, gun.range.short - 1);
    const medium = hitChance(world, shooter, target, gun, gun.range.medium - 1);
    const long = hitChance(world, shooter, target, gun, gun.range.long - 1);
    const beyond = hitChance(world, shooter, target, gun, gun.range.long + 1);

    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
    expect(long).toBeGreaterThan(beyond);
  });

  it('penalises firing inside a weapon minimum range', () => {
    const lrm = weapon('lrm10');
    expect(lrm.range.min).toBeGreaterThan(0);
    const inside = hitChance(world, shooter, target, lrm, lrm.range.min - 1);
    const outside = hitChance(world, shooter, target, lrm, lrm.range.min + 1);
    expect(inside).toBeLessThan(outside);
  });

  it('rewards standing still and punishes chasing a runner', () => {
    const gun = weapon('ac5');
    const still = hitChance(world, shooter, target, gun, 100);

    shooter.motion = 'run';
    const moving = hitChance(world, shooter, target, gun, 100);
    expect(moving).toBeLessThan(still);

    shooter.motion = 'stationary';
    target.motion = 'run';
    expect(hitChance(world, shooter, target, gun, 100)).toBeLessThan(still);
  });

  it('scales with pilot gunnery skill', () => {
    const gun = weapon('ac5');
    shooter.pilot.gunnery = 5;
    const expert = hitChance(world, shooter, target, gun, 100);
    shooter.pilot.gunnery = 1;
    expect(hitChance(world, shooter, target, gun, 100)).toBeLessThan(expert);
  });

  it('applies the called-shot penalty', () => {
    const gun = weapon('ac5');
    const open = hitChance(world, shooter, target, gun, 100);
    shooter.calledShot = 'left_leg';
    expect(hitChance(world, shooter, target, gun, 100)).toBeLessThan(open);
  });
});

describe('updateWeapons', () => {
  it('fires at a target inside arc, range and line of sight', () => {
    shooter.targetId = target.id;
    updateWeapons(world, shooter);
    expect(eventsOfType(world.events, 'weapon_fired').length).toBeGreaterThan(0);
  });

  it('holds fire when the target sits outside the firing arc', () => {
    shooter.targetId = target.id;
    shooter.facing = Math.PI;
    updateWeapons(world, shooter);
    expect(eventsOfType(world.events, 'weapon_fired')).toHaveLength(0);
  });

  it('holds fire while shut down', () => {
    shooter.targetId = target.id;
    shooter.shutdownRemaining = 4;
    updateWeapons(world, shooter);
    expect(eventsOfType(world.events, 'weapon_fired')).toHaveLength(0);
  });

  it('puts a weapon on cooldown and will not fire it again until it clears', () => {
    shooter.targetId = target.id;
    updateWeapons(world, shooter);

    const fired = shooter.weapons.filter((mount) => mount.cooldown > 0);
    expect(fired.length).toBeGreaterThan(0);

    const before = eventsOfType(world.events, 'weapon_fired').length;
    updateWeapons(world, shooter);
    expect(eventsOfType(world.events, 'weapon_fired').length).toBe(before);
  });

  it('spends a round of ammo per volley, not per missile', () => {
    shooter.targetId = target.id;
    const bin = shooter.ammoBins.find((entry) => entry.weaponId === 'lrm10');
    expect(bin).toBeDefined();

    const before = bin?.rounds ?? 0;
    updateWeapons(world, shooter);

    const mounts = shooter.weapons.filter((mount) => mount.weaponId === 'lrm10').length;
    expect(bin?.rounds).toBe(before - mounts);
  });

  it('stops firing an ammo weapon once its bins run dry', () => {
    shooter.targetId = target.id;
    for (const bin of shooter.ammoBins) bin.rounds = 0;

    updateWeapons(world, shooter);
    const fired = eventsOfType(world.events, 'weapon_fired').map((event) => event.weaponId);
    for (const weaponId of fired) {
      expect(world.catalog.weapons.get(weaponId)?.ammoPerTon).toBeNull();
    }
  });

  it('resolves energy weapons on the tick they are fired', () => {
    shooter.targetId = target.id;
    shooter.weapons = shooter.weapons.filter((mount) => mount.weaponId === 'large_laser');
    updateWeapons(world, shooter);

    expect(world.projectiles.length).toBeGreaterThan(0);
    expect(world.projectiles.every((shot) => shot.impactTick === world.tick)).toBe(true);
  });

  it('gives ballistic rounds a travel time', () => {
    shooter.pos = { x: 150, y: 12 };
    target.pos = { x: 450, y: 12 };
    expect(lineOfSight(world.terrain, shooter.pos, target.pos).clear).toBe(true);

    shooter.targetId = target.id;
    shooter.weapons = shooter.weapons.filter((mount) => mount.weaponId === 'ac5');
    updateWeapons(world, shooter);

    expect(world.projectiles.length).toBeGreaterThan(0);
    expect(world.projectiles.every((shot) => shot.impactTick > world.tick)).toBe(true);
  });

  it('holds fire when terrain blocks the shot', () => {
    shooter.pos = { x: 500, y: 500 };
    target.pos = { x: 850, y: 500 };
    expect(lineOfSight(world.terrain, shooter.pos, target.pos).clear).toBe(false);

    shooter.targetId = target.id;
    updateWeapons(world, shooter);
    expect(eventsOfType(world.events, 'weapon_fired')).toHaveLength(0);
  });
});

describe('resolveProjectiles', () => {
  it('credits damage to the shooter and taken damage to the target', () => {
    world.projectiles.push({
      shooterId: shooter.id,
      targetId: target.id,
      weaponId: 'ac5',
      hit: true,
      from: offTheNose(target),
      calledShot: null,
      damage: 5,
      impactTick: world.tick,
    });

    resolveProjectiles(world);

    expect(shooter.stats.damageDealt).toBe(5);
    expect(target.stats.damageTaken).toBe(5);

    // The location is rolled at impact now, so the fixture cannot name it —
    // but exactly one plate should be five points down.
    const lost = LOCATIONS.reduce(
      (sum, location) => sum + (target.locations[location].armourMax - target.locations[location].armour),
      0,
    );
    expect(lost).toBe(5);
  });

  it('reports misses without dealing damage', () => {
    world.projectiles.push({
      shooterId: shooter.id,
      targetId: target.id,
      weaponId: 'ac5',
      hit: false,
      from: offTheNose(target),
      calledShot: null,
      damage: 5,
      impactTick: world.tick,
    });

    resolveProjectiles(world);
    expect(eventsOfType(world.events, 'projectile_miss')).toHaveLength(1);
    expect(target.stats.damageTaken).toBe(0);
  });

  it('leaves shots still in flight alone', () => {
    world.projectiles.push({
      shooterId: shooter.id,
      targetId: target.id,
      weaponId: 'ac5',
      hit: true,
      from: offTheNose(target),
      calledShot: null,
      damage: 5,
      impactTick: world.tick + 5,
    });

    resolveProjectiles(world);
    expect(world.projectiles).toHaveLength(1);
    expect(target.stats.damageTaken).toBe(0);
  });

  it('credits exactly one kill for the shot that finishes a mech', () => {
    for (let shot = 0; shot < 3; shot += 1) {
      world.projectiles.push({
        shooterId: shooter.id,
        targetId: target.id,
        weaponId: 'gauss_rifle',
        hit: true,
        from: offTheNose(target),
        calledShot: null,
        damage: 10_000,
        impactTick: world.tick,
      });
    }

    resolveProjectiles(world);
    expect(target.destroyed).toBe(true);
    expect(shooter.stats.kills).toBe(1);
  });
});

describe('hit location table', () => {
  it('matches the weighted distribution in the rules', () => {
    const weights = world.rules.combat.hitLocationWeights;
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

    const counts = new Map<string, number>();
    const samples = 40_000;
    for (let roll = 0; roll < samples; roll += 1) {
      const location = world.rng.weighted(world.hitLocationTable);
      counts.set(location, (counts.get(location) ?? 0) + 1);
    }

    expect((counts.get('centre_torso') ?? 0) / samples).toBeCloseTo(weights.centre_torso / total, 2);
    expect((counts.get('head') ?? 0) / samples).toBeCloseTo(weights.head / total, 2);
    expect((counts.get('left_leg') ?? 0) / samples).toBeCloseTo(weights.left_leg / total, 2);
  });
});
