import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, testWorld, unitOf } from '../../tests/support';
import { hitChance } from './combat';
import { hitPreview } from './preview';
import type { MechEntity, World } from './types';

let world: World;
let shooter: MechEntity;
let target: MechEntity;

beforeEach(() => {
  world = testWorld('preview');
  shooter = unitOf(world, 'bulwark_assault');
  target = unitOf(world, 'falchion_duellist');
  // Open ground, close enough for everything, facing each other.
  shooter.pos = { x: 500, y: 500 };
  shooter.facing = 0;
  target.pos = { x: 620, y: 500 };
  target.facing = Math.PI;
});

describe('the to-hit readout', () => {
  it('reports for a firing weapon exactly what the resolver would roll', () => {
    const preview = hitPreview(world, shooter, target);
    expect(preview).not.toBeNull();
    if (preview === null) return;

    const live = preview.weapons.find((entry) => entry.blocked === null);
    expect(live).toBeDefined();
    if (live === undefined) return;

    const weapon = catalog.weapons.get(live.weaponId);
    expect(weapon).toBeDefined();
    if (weapon === undefined) return;

    // The one property that makes the readout trustworthy: it is the same
    // number the shot will actually be rolled against, not an approximation
    // maintained in parallel that can drift.
    expect(live.chance).toBe(hitChance(world, shooter, target, weapon, preview.range));
  });

  it('never touches the battle rng, however often it is asked', () => {
    const before = world.rng.save();
    for (let i = 0; i < 100; i += 1) hitPreview(world, shooter, target);
    expect(world.rng.save()).toEqual(before);
  });

  it('is blocked by range past a weapon\'s absolute reach', () => {
    target.pos = { x: shooter.pos.x + 5_000, y: shooter.pos.y };
    const preview = hitPreview(world, shooter, target);
    expect(preview?.weapons.every((entry) => entry.blocked === 'range')).toBe(true);
  });

  it('is blocked by arc only past what the torso can wind to', () => {
    // Directly behind: outside firing arc plus twist for any mech.
    target.pos = { x: shooter.pos.x - 120, y: shooter.pos.y };
    const preview = hitPreview(world, shooter, target);
    expect(preview?.weapons.some((entry) => entry.blocked === 'arc')).toBe(true);

    // Off the nose but within the wind-up: the readout must not cry "off arc"
    // at a hull that merely is not looking yet — that is advice, not noise.
    const reachable = (world.rules.combat.firingArcDegrees / 2) * (Math.PI / 180)
      + shooter.twistLimit - 0.1;
    target.pos = {
      x: shooter.pos.x + Math.cos(reachable) * 120,
      y: shooter.pos.y + Math.sin(reachable) * 120,
    };
    const after = hitPreview(world, shooter, target);
    expect(after?.weapons.some((entry) => entry.blocked === 'arc')).toBe(false);
  });

  it('marks a dry gun rather than pricing a shot it cannot take', () => {
    for (const bin of shooter.ammoBins) bin.rounds = 0;
    const preview = hitPreview(world, shooter, target);
    const ammoFed = preview?.weapons.filter((entry) => {
      const weapon = catalog.weapons.get(entry.weaponId);
      return weapon !== undefined && weapon.ammoPerTon !== null;
    });
    expect(ammoFed?.length).toBeGreaterThan(0);
    expect(ammoFed?.every((entry) => entry.blocked === 'ammo')).toBe(true);
  });

  it('marks a wrecked mount as destroyed', () => {
    const mount = shooter.weapons[0];
    if (mount === undefined) throw new Error('the shooter has no weapons');
    mount.destroyed = true;
    const preview = hitPreview(world, shooter, target);
    expect(preview?.weapons[0]?.blocked).toBe('destroyed');
  });

  it('explains cover when the target stands in it, and stays quiet when not', () => {
    const open = hitPreview(world, shooter, target);
    expect(open?.factors.some((factor) => factor.id === 'cover')).toBe(false);

    // A forest tile on ridge_pass: rows 5-11 around column 6 are 'f'.
    target.pos = { x: 6 * 24 + 12, y: 6 * 24 + 12 };
    shooter.pos = { x: target.pos.x + 100, y: target.pos.y };
    shooter.facing = Math.PI;
    const wooded = hitPreview(world, shooter, target);
    const cover = wooded?.factors.find((factor) => factor.id === 'cover');
    expect(cover).toBeDefined();
    expect(cover?.value ?? 1).toBeLessThan(1);
  });

  it('prices a downed target the way the resolver does', () => {
    target.downRemaining = 3;
    const preview = hitPreview(world, shooter, target);
    const prone = preview?.factors.find((factor) => factor.id === 'prone');
    expect(prone?.value).toBe(world.rules.stability.proneAccuracyFactor);
  });

  it('has nothing to say about a dead target', () => {
    target.destroyed = true;
    expect(hitPreview(world, shooter, target)).toBeNull();
  });
});
