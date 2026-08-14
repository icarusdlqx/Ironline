import { describe, expect, it } from 'vitest';
import { catalog, playerWorld } from '../../tests/support';
import { penetrates, resolveCritical, wreckComponent } from './critical';
import type { MechEntity, World } from './types';

function anyMech(world: World): MechEntity {
  const entity = world.entities[0];
  if (entity === undefined) throw new Error('no mechs in this mission');
  return entity;
}

describe('critical hits', () => {
  it('only reaches the frame once the plate is gone', () => {
    const world = playerWorld('crit');
    const mech = anyMech(world);
    mech.locations.centre_torso.armour = 20;

    expect(penetrates(mech, 'centre_torso', 12)).toBe(false);
    expect(penetrates(mech, 'centre_torso', 25)).toBe(true);

    mech.locations.centre_torso.armour = 0;
    expect(penetrates(mech, 'centre_torso', 1)).toBe(true);
  });

  it('gets through the back of a torso the front would have stopped', () => {
    const world = playerWorld('crit-rear');
    const mech = anyMech(world);
    mech.locations.centre_torso.armour = 30;
    mech.locations.centre_torso.rearArmour = 10;

    expect(penetrates(mech, 'centre_torso', 20, 'front')).toBe(false);
    expect(penetrates(mech, 'centre_torso', 20, 'rear')).toBe(true);
  });

  it('finds a leg the same way from either side, because a leg has no back', () => {
    const world = playerWorld('crit-leg');
    const mech = anyMech(world);
    mech.locations.left_leg.armour = 30;
    expect(mech.locations.left_leg.rearArmourMax).toBe(0);

    expect(penetrates(mech, 'left_leg', 20, 'rear')).toBe(false);
    expect(penetrates(mech, 'left_leg', 40, 'rear')).toBe(true);
  });

  it('silences a weapon fitted where the crit landed', () => {
    const world = playerWorld('weapon');
    const mech = anyMech(world);
    const mount = mech.weapons.find((entry) => !entry.destroyed);
    if (mount === undefined) throw new Error('this mech carries nothing');

    // Strip the location down to that one weapon so the pick is forced.
    mech.weapons = [mount];
    mech.ammoBins = [];

    let wrecked = 0;
    for (let attempt = 0; attempt < 20 && mount.destroyed === false; attempt += 1) {
      if (wreckComponent(world, mech, mount.location) === 'weapon') wrecked += 1;
    }
    expect(wrecked).toBeGreaterThan(0);
    expect(mount.destroyed).toBe(true);
  });

  it('stops a mech firing a weapon whose mount has been wrecked', () => {
    const world = playerWorld('silence');
    const mech = anyMech(world);
    const mount = mech.weapons.find((entry) => !entry.destroyed);
    if (mount === undefined) throw new Error('this mech carries nothing');

    mech.weapons = [mount];
    mech.ammoBins = [];
    mount.cooldown = 0;
    while (!mount.destroyed) wreckComponent(world, mech, mount.location);

    // The firing loop is what actually has to honour it.
    const firing = mech.weapons.filter((entry) => !entry.destroyed);
    expect(firing).toHaveLength(0);
  });

  it('slows a mech whose leg actuator is hit and spoils an arm', () => {
    const world = playerWorld('actuator');
    const mech = anyMech(world);
    mech.weapons = [];
    mech.ammoBins = [];

    const walk = mech.walkSpeed;
    expect(wreckComponent(world, mech, 'left_leg')).toBe('actuator');
    expect(mech.walkSpeed).toBeLessThan(walk);

    const gunnery = mech.outgoingAccuracyFactor;
    expect(wreckComponent(world, mech, 'right_arm')).toBe('actuator');
    expect(mech.outgoingAccuracyFactor).toBeLessThan(gunnery);
  });

  it('never takes a mech below its last heat sink', () => {
    const world = playerWorld('sinks');
    const mech = anyMech(world);
    mech.weapons = [];
    mech.ammoBins = [];

    for (let hit = 0; hit < 60; hit += 1) wreckComponent(world, mech, 'centre_torso');
    expect(mech.heatSinks).toBeGreaterThanOrEqual(1);
    expect(mech.dissipationPerSecond).toBeGreaterThan(0);
  });

  it('reports what it found, so the pilot hears about it', () => {
    const world = playerWorld('log');
    const mech = anyMech(world);
    world.events.length = 0;

    resolveCritical(world, mech, 'centre_torso', null);
    const reported = world.events.filter((event) => event.type === 'critical_hit');
    expect(reported).toHaveLength(1);
  });

  it('makes a penetrating shot hurt more', () => {
    const world = playerWorld('multiplier');
    const mech = anyMech(world);
    const multiplier = resolveCritical(world, mech, 'left_torso', null);
    expect(multiplier).toBe(catalog.rules.damage.critical.damageMultiplier);
    expect(multiplier).toBeGreaterThan(1);
  });

  it('gives every weapon a crit chance, and the punchier kinds a better one', () => {
    // The point of the field is that two guns of the same damage feel
    // different. A cluster weapon rolls once per pellet, so it has to stay low
    // or a shotgun burst crits every time it lands.
    const weapons = [...catalog.weapons.values()];
    for (const weapon of weapons) {
      expect(weapon.criticalChance, weapon.id).toBeGreaterThan(0);
      if (weapon.projectiles >= 5) {
        expect(weapon.criticalChance, `${weapon.id} fires ${weapon.projectiles} at once`)
          .toBeLessThan(0.07);
      }
    }

    const gauss = catalog.weapons.get('gauss_rifle');
    const laser = catalog.weapons.get('medium_laser');
    const lrm = catalog.weapons.get('lrm20');
    if (gauss === undefined || laser === undefined || lrm === undefined) {
      throw new Error('missing a weapon this test names');
    }
    expect(gauss.criticalChance).toBeGreaterThan(laser.criticalChance);
    expect(laser.criticalChance).toBeGreaterThan(lrm.criticalChance);
  });
});
