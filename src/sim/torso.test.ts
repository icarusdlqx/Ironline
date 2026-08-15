import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, testWorld, unitOf } from '../../tests/support';
import { hitChance } from './combat';
import { angleDifference, bearing } from './math';
import { updateTorso, weaponBearing } from './movement';
import type { MechEntity, World } from './types';

const DEGREES = Math.PI / 180;

let world: World;
let shooter: MechEntity;
let target: MechEntity;

function settle(ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) updateTorso(world, shooter);
}

beforeEach(() => {
  world = testWorld('torso');
  shooter = unitOf(world, 'sentinel_brawler');
  target = unitOf(world, 'halberd_prime');

  shooter.pos = { x: 400, y: 400 };
  shooter.facing = 0;
  shooter.torsoOffset = 0;
  shooter.targetId = target.id;
});

describe('torso twist', () => {
  it('swings the guns onto a target standing off the hull centreline', () => {
    target.pos = { x: 400, y: 500 };
    const wanted = angleDifference(shooter.facing, bearing(shooter.pos, target.pos));

    settle(200);

    expect(weaponBearing(shooter)).toBeCloseTo(bearing(shooter.pos, target.pos), 3);
    expect(shooter.torsoOffset).toBeCloseTo(wanted, 3);
  });

  it('stops at the twist limit rather than spinning the torso round', () => {
    // Directly behind: further than the torso can physically turn.
    target.pos = { x: 300, y: 400 };
    settle(400);

    const limit = catalog.rules.movement.torsoTwistDegrees * DEGREES;
    expect(Math.abs(shooter.torsoOffset)).toBeLessThanOrEqual(limit + 1e-6);
    expect(Math.abs(shooter.torsoOffset)).toBeCloseTo(limit, 3);
  });

  it('turns no faster than the torso turn rate allows', () => {
    target.pos = { x: 400, y: 500 };
    const rate = catalog.rules.movement.torsoTurnRateDegreesPerSecond * DEGREES * world.dt;

    updateTorso(world, shooter);

    expect(Math.abs(shooter.torsoOffset)).toBeLessThanOrEqual(rate + 1e-9);
  });

  it('recentres once there is nothing to track', () => {
    target.pos = { x: 400, y: 500 };
    settle(200);
    expect(shooter.torsoOffset).not.toBe(0);

    shooter.targetId = null;
    settle(200);

    expect(shooter.torsoOffset).toBeCloseTo(0, 6);
  });

  it('lets a mech shoot at something its hull is not facing', () => {
    // Ninety degrees off the nose is outside no firing arc, but only because
    // the torso got there first — the hull never turned.
    target.pos = { x: 400, y: 500 };
    settle(200);

    const halfArc = (catalog.rules.combat.firingArcDegrees / 2) * DEGREES;
    const aim = angleDifference(weaponBearing(shooter), bearing(shooter.pos, target.pos));

    expect(shooter.facing).toBe(0);
    expect(Math.abs(aim)).toBeLessThan(halfArc);
  });
});

describe('designators', () => {
  it('makes a painted target easier for everyone to hit', () => {
    const weapon = catalog.weapons.get('medium_laser');
    expect(weapon).toBeDefined();
    if (weapon === undefined) return;

    target.pos = { x: 400, y: 460 };
    target.motion = 'stationary';
    shooter.motion = 'stationary';

    // Far enough out that the painted shot has room under the hit-chance
    // ceiling: at knife range the base chance is already near it and the
    // factor is clipped away before it can be measured.
    const plain = hitChance(world, shooter, target, weapon, 200);
    target.designatedUntilTick = world.tick + 20;
    const painted = hitChance(world, shooter, target, weapon, 200);

    // Both sit below the ceiling, so the factor shows through.
    expect(painted).toBeGreaterThan(plain);
    expect(painted / plain).toBeCloseTo(catalog.rules.combat.tagFactor, 2);
  });

  it('thins a missile volley against a mech carrying AMS', () => {
    const missile = catalog.weapons.get('srm6');
    const laser = catalog.weapons.get('medium_laser');
    expect(missile).toBeDefined();
    expect(laser).toBeDefined();
    if (missile === undefined || laser === undefined) return;

    target.pos = { x: 400, y: 460 };
    const beforeMissile = hitChance(world, shooter, target, missile, 60);
    const beforeLaser = hitChance(world, shooter, target, laser, 60);

    target.amsMissileFactor = 0.68;

    expect(hitChance(world, shooter, target, missile, 60)).toBeLessThan(beforeMissile);
    expect(hitChance(world, shooter, target, laser, 60)).toBe(beforeLaser);
  });
});
