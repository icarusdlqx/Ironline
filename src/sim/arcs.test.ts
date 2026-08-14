import { beforeEach, describe, expect, it } from 'vitest';
import { LOCATIONS } from '../schema/common';
import { catalog, testWorld, unitOf } from '../../tests/support';
import { attackArcFrom, buildArcTables } from './arcs';
import { resolveProjectiles } from './combat';
import { eventsOfType } from './events';
import type { MechEntity, Vec2, World } from './types';

let world: World;
let target: MechEntity;
let shooter: MechEntity;

/** A point `degrees` round from the target's nose, clockwise. */
function around(of: MechEntity, degrees: number, distance = 100): Vec2 {
  const angle = of.facing + degrees * (Math.PI / 180);
  return { x: of.pos.x + Math.cos(angle) * distance, y: of.pos.y + Math.sin(angle) * distance };
}

/** Fires one shot from `from` and returns what the target actually lost. */
function shoot(from: Vec2, damage = 20): number {
  const before = target.stats.damageTaken;
  world.projectiles.push({
    shooterId: shooter.id,
    targetId: target.id,
    weaponId: 'ac5',
    hit: true,
    from,
    calledShot: null,
    damage,
    impactTick: world.tick,
  });
  resolveProjectiles(world);
  return target.stats.damageTaken - before;
}

beforeEach(() => {
  world = testWorld('arcs');
  shooter = unitOf(world, 'bulwark_assault');
  target = unitOf(world, 'bulwark_burner');
  target.pos = { x: 500, y: 500 };
  target.facing = 0;
});

describe('attack arcs', () => {
  it('reads the nose, the flanks and the tail off the hull', () => {
    const rules = world.rules.combat;
    expect(attackArcFrom(rules, target, around(target, 0)).arc).toBe('front');
    expect(attackArcFrom(rules, target, around(target, 45)).arc).toBe('front');
    expect(attackArcFrom(rules, target, around(target, 90)).arc).toBe('side');
    expect(attackArcFrom(rules, target, around(target, -90)).arc).toBe('side');
    expect(attackArcFrom(rules, target, around(target, 180)).arc).toBe('rear');
    expect(attackArcFrom(rules, target, around(target, 160)).arc).toBe('rear');
  });

  it('tells the two flanks apart', () => {
    const rules = world.rules.combat;
    expect(attackArcFrom(rules, target, around(target, 90)).near).toBe('right');
    expect(attackArcFrom(rules, target, around(target, -90)).near).toBe('left');
  });

  it('reads the hull, not the torso', () => {
    // A mech can wind its torso round to shoot behind itself. The plating does
    // not come with it, and that is the whole point of flanking.
    const rules = world.rules.combat;
    target.torsoOffset = Math.PI / 2;
    expect(attackArcFrom(rules, target, around(target, 180)).arc).toBe('rear');
  });

  it('covers every direction with exactly one arc', () => {
    const rules = world.rules.combat;
    for (let degrees = -180; degrees < 180; degrees += 3) {
      const arc = attackArcFrom(rules, target, around(target, degrees)).arc;
      expect(['front', 'side', 'rear']).toContain(arc);
    }
  });
});

describe('arc damage', () => {
  it('hurts more from the flank than from the front, and most from behind', () => {
    const front = world.rules.combat.attackArcs.front.damageFactor;
    const side = world.rules.combat.attackArcs.side.damageFactor;
    const rear = world.rules.combat.attackArcs.rear.damageFactor;

    expect(side).toBeGreaterThan(front);
    expect(rear).toBeGreaterThan(side);
  });

  it('applies the rear multiplier to a shot that lands from behind', () => {
    for (const location of LOCATIONS) target.locations[location].armour = 10_000;

    const nose = shoot(around(target, 0), 20);
    const tail = shoot(around(target, 180), 20);

    expect(nose).toBeCloseTo(20 * world.rules.combat.attackArcs.front.damageFactor, 6);
    expect(tail).toBeCloseTo(20 * world.rules.combat.attackArcs.rear.damageFactor, 6);
    expect(tail).toBeGreaterThan(nose);
  });

  it('settles the arc at impact, so turning to meet a shell still helps', () => {
    for (const location of LOCATIONS) target.locations[location].armour = 10_000;

    // Fired at the target's back, but it turns around before the round lands.
    const from = around(target, 180);
    world.projectiles.push({
      shooterId: shooter.id,
      targetId: target.id,
      weaponId: 'ac5',
      hit: true,
      from,
      calledShot: null,
      damage: 20,
      impactTick: world.tick,
    });
    target.facing = Math.PI;

    const before = target.stats.damageTaken;
    resolveProjectiles(world);
    const taken = target.stats.damageTaken - before;

    expect(taken).toBeCloseTo(20 * world.rules.combat.attackArcs.front.damageFactor, 6);
  });

  it('reports the arc so the player can see where a hit landed', () => {
    shoot(around(target, 180));
    expect(eventsOfType(world.events, 'projectile_hit')[0]?.arc).toBe('rear');
  });
});

describe('arc hit locations', () => {
  const tables = buildArcTables(catalog.rules.combat);

  it('builds a table for both flanks of every arc', () => {
    for (const key of ['front:left', 'front:right', 'side:left', 'side:right', 'rear:left', 'rear:right'] as const) {
      expect(tables[key].length, key).toBeGreaterThan(0);
    }
  });

  it('mirrors the near side onto the flank the fire is coming from', () => {
    const weightOf = (key: 'side:left' | 'side:right', location: string): number =>
      tables[key].find((entry) => entry.value === location)?.weight ?? 0;

    expect(weightOf('side:right', 'right_torso')).toBe(weightOf('side:left', 'left_torso'));
    expect(weightOf('side:right', 'right_torso')).toBeGreaterThan(
      weightOf('side:right', 'left_torso'),
    );
  });

  it('puts most of a flanking shot into the near side of the mech', () => {
    for (const location of LOCATIONS) target.locations[location].armour = 10_000;

    const counts = new Map<string, number>();
    for (let shot = 0; shot < 2_000; shot += 1) {
      // The location states are shared objects, so the snapshot has to copy the
      // numbers out rather than the record.
      const before = LOCATIONS.map((location) => target.locations[location].armour);
      shoot(around(target, 90), 1);
      LOCATIONS.forEach((location, index) => {
        if (target.locations[location].armour < (before[index] ?? 0)) {
          counts.set(location, (counts.get(location) ?? 0) + 1);
        }
      });
    }

    const right = (counts.get('right_torso') ?? 0) + (counts.get('right_arm') ?? 0);
    const left = (counts.get('left_torso') ?? 0) + (counts.get('left_arm') ?? 0);
    expect(right).toBeGreaterThan(left * 3);
  });

  it('barely touches the arms of a mech shot in the back', () => {
    const arms = catalog.rules.combat.attackArcs.rear.hitLocationWeights;
    const front = catalog.rules.combat.attackArcs.front.hitLocationWeights;
    expect(arms.near_arm).toBeLessThan(front.near_arm);
  });
});

describe('rear armour', () => {
  const TORSOS = ['centre_torso', 'left_torso', 'right_torso'] as const;

  it('splits exactly what the design paid for, and no more', () => {
    const design = catalog.designs.get('bulwark_burner');
    expect(design).toBeDefined();
    for (const location of LOCATIONS) {
      const state = target.locations[location];
      expect(state.armourMax + state.rearArmourMax, location).toBe(design?.armour[location]);
    }
  });

  it('eats the back plate and leaves the glacis alone', () => {
    for (const location of LOCATIONS) {
      const state = target.locations[location];
      state.armour = 10_000;
      if (state.rearArmourMax > 0) state.rearArmour = 10_000;
    }

    const glacis = TORSOS.map((location) => target.locations[location].armour);
    for (let shot = 0; shot < 200; shot += 1) shoot(around(target, 180), 5);

    // Only the torsos are checked: a head, arm or leg has no back, so rear fire
    // on one correctly meets the only plate it has.
    TORSOS.forEach((location, index) => {
      expect(target.locations[location].armour, location).toBe(glacis[index]);
    });
    expect(Math.min(...TORSOS.map((l) => target.locations[l].rearArmour))).toBeLessThan(10_000);
  });

  it('meets the front plate on a flanking shot', () => {
    for (const location of LOCATIONS) target.locations[location].armour = 10_000;
    const backs = TORSOS.map((location) => target.locations[location].rearArmour);

    for (let shot = 0; shot < 200; shot += 1) shoot(around(target, 90), 5);

    TORSOS.forEach((location, index) => {
      expect(target.locations[location].rearArmour, location).toBe(backs[index]);
    });
  });

  it('gives a leg no back, so fire from behind meets its only plate', () => {
    for (const location of LOCATIONS) target.locations[location].armour = 10_000;
    expect(target.locations.left_leg.rearArmourMax).toBe(0);

    world.projectiles.push({
      shooterId: shooter.id,
      targetId: target.id,
      weaponId: 'ac5',
      hit: true,
      from: around(target, 180),
      calledShot: 'left_leg',
      damage: 40,
      impactTick: world.tick,
    });
    resolveProjectiles(world);

    expect(target.locations.left_leg.armour).toBeLessThan(10_000);
  });
});
