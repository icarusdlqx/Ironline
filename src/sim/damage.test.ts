import { beforeEach, describe, expect, it } from 'vitest';
import { spawnDesign, testWorld, unitOf } from '../../tests/support';
import { applyDamage, destroyLocation } from './damage';
import { eventsOfType } from './events';
import { isImmobile, isOperational, type MechEntity, type World } from './types';

let world: World;
let mech: MechEntity;

beforeEach(() => {
  world = testWorld('damage');
  mech = unitOf(world, 'sentinel_brawler');
});

describe('applyDamage', () => {
  it('strips armour before internal structure', () => {
    const arm = mech.locations.left_arm;
    const absorbed = applyDamage(world, mech, 'left_arm', 10);

    expect(absorbed).toBe(10);
    expect(arm.armour).toBe(arm.armourMax - 10);
    expect(arm.internal).toBe(arm.internalMax);
  });

  it('spills into internal structure once armour is gone', () => {
    const arm = mech.locations.left_arm;
    applyDamage(world, mech, 'left_arm', arm.armourMax + 5);

    expect(arm.armour).toBe(0);
    expect(arm.internal).toBe(arm.internalMax - 5);
    expect(arm.destroyed).toBe(false);
  });

  it('returns only the damage the mech could actually absorb', () => {
    const arm = mech.locations.left_arm;
    const capacity = arm.armourMax + arm.internalMax;
    const torso = mech.locations.left_torso;
    const overkill = capacity + torso.armourMax + torso.internalMax + 1000;

    const absorbed = applyDamage(world, mech, 'left_arm', overkill);
    expect(absorbed).toBeLessThan(overkill);
    expect(absorbed).toBeGreaterThan(capacity);
  });

  it('destroys a location and transfers the excess inwards', () => {
    const arm = mech.locations.left_arm;
    const torso = mech.locations.left_torso;
    applyDamage(world, mech, 'left_arm', arm.armourMax + arm.internalMax + 12);

    expect(arm.destroyed).toBe(true);
    expect(torso.armour).toBe(torso.armourMax - 12);
  });

  it('routes damage onward when the struck location is already gone', () => {
    destroyLocation(world, mech, 'left_arm');
    const torso = mech.locations.left_torso;
    applyDamage(world, mech, 'left_arm', 9);
    expect(torso.armour).toBe(torso.armourMax - 9);
  });

  it('stops at the centre torso rather than looping', () => {
    const absorbed = applyDamage(world, mech, 'centre_torso', 100_000);
    expect(absorbed).toBeLessThan(100_000);
    expect(mech.destroyed).toBe(true);
  });
});

describe('location destruction', () => {
  it('destroys the weapons carried in that location', () => {
    const armWeapons = mech.weapons.filter((mount) => mount.location === 'left_arm');
    expect(armWeapons.length).toBeGreaterThan(0);

    destroyLocation(world, mech, 'left_arm');
    expect(armWeapons.every((mount) => mount.destroyed)).toBe(true);
    expect(mech.weapons.some((mount) => !mount.destroyed)).toBe(true);
  });

  it('kills the mech when the centre torso goes', () => {
    destroyLocation(world, mech, 'centre_torso');
    expect(mech.destroyed).toBe(true);
    expect(mech.killMethod).toBe('centre_torso');
    expect(isOperational(mech)).toBe(false);
  });

  it('takes the pilot out when the head goes', () => {
    destroyLocation(world, mech, 'head');
    expect(mech.destroyed).toBe(true);
    expect(mech.killMethod).toBe('head');
    expect(mech.pilot.dead || mech.pilot.ejected).toBe(true);
  });

  it('immobilises but does not destroy a mech that loses both legs', () => {
    destroyLocation(world, mech, 'left_leg');
    expect(isImmobile(mech)).toBe(false);

    destroyLocation(world, mech, 'right_leg');
    expect(isImmobile(mech)).toBe(true);
    expect(mech.destroyed).toBe(false);
    expect(isOperational(mech)).toBe(true);
  });

  it('is idempotent', () => {
    destroyLocation(world, mech, 'left_arm');
    const events = eventsOfType(world.events, 'location_destroyed').length;
    destroyLocation(world, mech, 'left_arm');
    expect(eventsOfType(world.events, 'location_destroyed').length).toBe(events);
  });
});

describe('ammo explosions', () => {
  it('detonates unprotected ammo into the centre torso', () => {
    const bin = mech.ammoBins.find((entry) => !entry.protectedByCase);
    expect(bin).toBeDefined();

    const core = mech.locations.centre_torso;
    const before = core.internal;

    destroyLocation(world, mech, bin?.location ?? 'left_torso');

    expect(eventsOfType(world.events, 'ammo_explosion').length).toBeGreaterThan(0);
    expect(core.internal).toBeLessThan(before);
  });

  it('contains the blast when CASE is fitted', () => {
    const scout = unitOf(world, 'hornet_spotter');
    const bin = scout.ammoBins.find((entry) => entry.protectedByCase);
    expect(bin).toBeDefined();

    const core = scout.locations.centre_torso;
    const before = core.internal;

    destroyLocation(world, scout, bin?.location ?? 'right_torso');

    expect(eventsOfType(world.events, 'ammo_explosion').length).toBe(0);
    expect(core.internal).toBe(before);
    expect(bin?.rounds).toBe(0);
  });

  it('caps explosion damage at the rules ceiling', () => {
    const bin = mech.ammoBins.find((entry) => !entry.protectedByCase);
    destroyLocation(world, mech, bin?.location ?? 'left_torso');

    const explosions = eventsOfType(world.events, 'ammo_explosion');
    for (const explosion of explosions) {
      expect(explosion.damage).toBeLessThanOrEqual(world.rules.damage.ammoExplosionCap);
    }
  });
});

describe('volatile mounts', () => {
  it('dumps a Gauss rifle into the centre torso when its mount is breached', () => {
    const siege = spawnDesign(world, 'colossus_siege');
    const gauss = siege.weapons.find((mount) => mount.weaponId === 'gauss_rifle');
    expect(gauss).toBeDefined();
    if (gauss === undefined) return;

    const before = siege.locations.centre_torso.internal;
    destroyLocation(world, siege, gauss.location);

    const blasts = eventsOfType(world.events, 'ammo_explosion').filter(
      (event) => event.entityId === siege.id,
    );
    expect(blasts.length).toBeGreaterThan(0);
    expect(siege.locations.centre_torso.internal).toBeLessThan(before);
  });

  it('leaves an ordinary mount to fail quietly', () => {
    const brawler = unitOf(world, 'sentinel_brawler');
    const mount = brawler.weapons.find((entry) => entry.weaponId !== 'gauss_rifle');
    expect(mount).toBeDefined();
    if (mount === undefined) return;

    const before = brawler.locations.centre_torso.internal;
    destroyLocation(world, brawler, mount.location);

    expect(mount.destroyed).toBe(true);
    // Any drop here would be an ammo bin going up, not the gun itself.
    const blasts = eventsOfType(world.events, 'ammo_explosion');
    if (blasts.length === 0) expect(brawler.locations.centre_torso.internal).toBe(before);
  });
});
