import { beforeEach, describe, expect, it } from 'vitest';
import { LOCATIONS } from '../schema/common';
import { FRAMES } from '../schema/rules';
import { catalog, spawnDesign, testWorld, unitOf } from '../../tests/support';
import { buildFrameArcTables } from './arcs';
import { separateBodies } from './collision';
import { resolveProjectiles } from './combat';
import { addStabilityImpulse } from './stability';
import { stepWorld } from './world';
import { difficultyTier, decideTactical } from './ai/tactical';
import { isImmobile, type MechEntity, type Vec2, type World } from './types';

let world: World;

beforeEach(() => {
  world = testWorld('frames');
});

/** The turret, dropped into a skirmish that does not field one. */
function emplacement(at: Vec2 = { x: 500, y: 500 }): MechEntity {
  return spawnDesign(world, 'redoubt_emplacement', 1, at);
}

describe('frames', () => {
  it('leaves every hull that was here first a mech', () => {
    for (const id of ['wisp_wsp1', 'sentinel_snl2', 'colossus_cls1']) {
      expect(catalog.chassis.get(id)?.frame, id).toBe('mech');
    }
  });

  it('gives the mech frame exactly the arc tables it had before frames existed', () => {
    // The whole reason frames.json says `arcs: null` for a mech. A weighted
    // draw walks its table in order, so a frame that restated these weights
    // could move every hit location in every battle in the game.
    const built = buildFrameArcTables(catalog.rules);
    expect(built.mech.profiles.front).toBe(catalog.rules.combat.attackArcs.front);
    expect(built.mech.profiles.side).toBe(catalog.rules.combat.attackArcs.side);
    expect(built.mech.profiles.rear).toBe(catalog.rules.combat.attackArcs.rear);
  });

  it('builds a usable table for every frame and every arc', () => {
    const built = buildFrameArcTables(catalog.rules);
    for (const frame of FRAMES) {
      for (const key of ['front:left', 'side:right', 'rear:left'] as const) {
        const table = built[frame].tables[key];
        expect(table.length, `${frame} ${key}`).toBeGreaterThan(0);
        expect(
          table.reduce((sum, entry) => sum + entry.weight, 0),
          `${frame} ${key}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('never puts a shot into an arm a vehicle or an emplacement does not have', () => {
    const built = buildFrameArcTables(catalog.rules);
    for (const frame of ['vehicle', 'turret'] as const) {
      for (const key of ['front:left', 'front:right', 'side:left', 'side:right', 'rear:left', 'rear:right'] as const) {
        const places = built[frame].tables[key].map((entry) => entry.value);
        expect(places, `${frame} ${key}`).not.toContain('left_arm');
        expect(places, `${frame} ${key}`).not.toContain('right_arm');
      }
    }
  });

  it('shoots an emplacement in the hull, never in the running gear it lacks', () => {
    const built = buildFrameArcTables(catalog.rules);
    for (const key of ['front:left', 'rear:right'] as const) {
      const places = built.turret.tables[key].map((entry) => entry.value);
      expect(places).not.toContain('left_leg');
      expect(places).not.toContain('right_leg');
      expect(places).toContain('centre_torso');
    }
  });

  it('leaves a vehicle its running gear to lose', () => {
    // Shooting the tracks off a carrier is the point of shooting at one.
    const places = buildFrameArcTables(catalog.rules).vehicle.tables['side:right'].map(
      (entry) => entry.value,
    );
    expect(places).toContain('right_leg');
  });
});

describe('an emplacement', () => {
  it('is immobile from the moment it spawns, with both legs intact', () => {
    const turret = emplacement();
    expect(turret.mobile).toBe(false);
    expect(isImmobile(turret)).toBe(true);
    expect(turret.locations.left_leg.destroyed).toBe(false);
    expect(turret.walkSpeed).toBe(0);
    expect(turret.turnRate).toBe(0);
  });

  it('brings its guns further round than a mech can twist', () => {
    const turret = emplacement();
    const mech = unitOf(world, 'sentinel_brawler');
    expect(turret.twistLimit).toBeGreaterThan(mech.twistLimit);
  });

  it('does not walk anywhere, however long the battle runs', () => {
    const turret = emplacement({ x: 500, y: 500 });
    const start = { ...turret.pos };
    for (let tick = 0; tick < 400; tick += 1) stepWorld(world, 6000);
    expect(turret.pos.x).toBeCloseTo(start.x, 6);
    expect(turret.pos.y).toBeCloseTo(start.y, 6);
  });

  it('never solves a path, so it cannot spend a battle re-deciding one', () => {
    const turret = emplacement();
    decideTactical(world, turret, null, difficultyTier(world, null));
    expect(turret.path).toHaveLength(0);
    expect(turret.motion).toBe('stationary');
    expect(turret.ai.destination).toBeNull();
  });

  it('never withdraws, because there is nowhere to withdraw to', () => {
    const turret = emplacement();
    for (const location of LOCATIONS) turret.locations[location].armour = 0;
    decideTactical(world, turret, null, difficultyTier(world, null));
    expect(turret.ai.withdrawing).toBe(false);
    expect(turret.path).toHaveLength(0);
  });

  it('still picks a target and shoots at it', () => {
    const turret = emplacement({ x: 500, y: 500 });
    const prey = unitOf(world, 'sentinel_brawler');
    prey.pos = { x: 560, y: 500 };
    prey.team = 0;

    decideTactical(world, turret, null, difficultyTier(world, null));
    expect(turret.targetId).toBe(prey.id);
  });

  it('cannot be knocked over', () => {
    const turret = emplacement();
    addStabilityImpulse(world, turret, 10_000);
    expect(turret.stability).toBe(0);
    expect(turret.downRemaining).toBe(0);
  });

  it('gives no ground when something walks into it', () => {
    // A lance cannot shoulder an emplacement aside; it goes round.
    const turret = emplacement({ x: 500, y: 500 });
    const mech = unitOf(world, 'wisp_scout');
    mech.pos = { x: 505, y: 500 };

    const before = { ...turret.pos };
    separateBodies(world);

    expect(turret.pos).toEqual(before);
    expect(mech.pos.x).toBeGreaterThan(505);
  });
});

describe('a vehicle', () => {
  it('moves, but cannot be shoved off tracks it is sitting on', () => {
    const carrier = spawnDesign(world, 'drover_carrier', 1, { x: 500, y: 500 });
    expect(carrier.mobile).toBe(true);
    expect(carrier.walkSpeed).toBeGreaterThan(0);
    expect(isImmobile(carrier)).toBe(false);

    addStabilityImpulse(world, carrier, 10_000);
    expect(carrier.stability).toBe(0);
  });

  it('is going nowhere once both track units are gone', () => {
    const carrier = spawnDesign(world, 'drover_carrier', 1, { x: 500, y: 500 });
    carrier.locations.left_leg.destroyed = true;
    carrier.locations.right_leg.destroyed = true;
    expect(isImmobile(carrier)).toBe(true);
  });

  it('takes more from behind than a mech does, on the same shot', () => {
    const shooter = unitOf(world, 'bulwark_assault');
    const carrier = spawnDesign(world, 'drover_carrier', 1, { x: 500, y: 500 });
    carrier.facing = 0;
    for (const location of LOCATIONS) carrier.locations[location].armour = 10_000;

    const behind = { x: carrier.pos.x - 100, y: carrier.pos.y };
    world.projectiles.push({
      shooterId: shooter.id,
      targetId: carrier.id,
      weaponId: 'ac5',
      hit: true,
      from: behind,
      calledShot: null,
      damage: 20,
      impactTick: world.tick,
    });
    resolveProjectiles(world);

    const mechRear = catalog.rules.combat.attackArcs.rear.damageFactor;
    const vehicleRear = catalog.rules.frames.entries.vehicle.arcs?.rear.damageFactor ?? 0;
    expect(vehicleRear).toBeGreaterThan(mechRear);
    expect(carrier.stats.damageTaken).toBeCloseTo(20 * vehicleRear, 6);
  });
});
