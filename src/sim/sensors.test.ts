import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, playerWorld, testWorld, unitOf } from '../../tests/support';
import {
  isIdentifiedBy,
  isVisibleTo,
  sensorRangeFor,
  signatureFor,
  tileExplored,
  tileVisible,
  updateVision,
} from './sensors';
import type { MechEntity, World } from './types';

let world: World;
let scout: MechEntity;
let enemy: MechEntity;

beforeEach(() => {
  world = playerWorld('sensors');
  scout = unitOf(world, 'hornet_spotter');
  enemy = unitOf(world, 'bulwark_burner');
});

describe('sensorRangeFor', () => {
  it('grows with the sensors skill', () => {
    const rules = catalog.rules.sensors;
    expect(sensorRangeFor(rules, 1)).toBe(rules.baseRange + rules.rangePerSkill);
    expect(sensorRangeFor(rules, 5)).toBeGreaterThan(sensorRangeFor(rules, 2));
  });

  it('is stamped onto each mech at spawn, scaled by the kit and the pilot', () => {
    for (const entity of world.entities) {
      const fromSkill = sensorRangeFor(catalog.rules.sensors, entity.pilot.sensors);
      const design = catalog.designs.get(entity.designId);
      const kit = (design?.equipment ?? []).reduce(
        (total, fit) => total * (catalog.equipment.get(fit.equipmentId)?.stats.sensor_range_factor ?? 1),
        1,
      );
      // A spotter sees further than their sensors rating alone would say — the
      // speciality is part of the machine's reach, not a separate readout.
      const speciality = entity.pilot.traits.reduce(
        (total, traitId) => total * (catalog.rules.pilotTraits.entries[traitId]?.sensorRangeFactor ?? 1),
        1,
      );
      expect(entity.sensorRange).toBeCloseTo(fromSkill * kit * speciality, 6);
    }
  });

  it('gives an Active Probe carrier more reach than its pilot alone would have', () => {
    const fromSkill = sensorRangeFor(catalog.rules.sensors, scout.pilot.sensors);
    expect(scout.sensorRange).toBeGreaterThan(fromSkill);
  });
});

describe('updateVision', () => {
  it('spots an enemy inside sensor range with clear line of sight', () => {
    scout.pos = { x: 500, y: 12 };
    enemy.pos = { x: 620, y: 12 };
    updateVision(world, world.vision!);

    expect(world.vision!.visible.has(enemy.id)).toBe(true);
    expect(isVisibleTo(world.vision, enemy)).toBe(true);
  });

  it('does not spot an enemy beyond sensor range', () => {
    scout.pos = { x: 20, y: 12 };
    for (const entity of world.entities) {
      if (entity.team === 0) entity.pos = { x: 20, y: 12 };
    }
    enemy.pos = { x: 20 + scout.sensorRange + 200, y: 12 };
    updateVision(world, world.vision!);

    expect(world.vision!.visible.has(enemy.id)).toBe(false);
  });

  it('does not spot an enemy behind terrain', () => {
    for (const entity of world.entities) {
      if (entity.team === 0) entity.pos = { x: 500, y: 500 };
    }
    enemy.pos = { x: 850, y: 500 };
    updateVision(world, world.vision!);

    expect(world.vision!.visible.has(enemy.id)).toBe(false);
  });

  it('never hides friendly units', () => {
    for (const entity of world.entities) {
      if (entity.team === 0) expect(isVisibleTo(world.vision, entity)).toBe(true);
    }
  });

  it('treats everything as visible when there is no vision tracking', () => {
    const headless = testWorld('novision');
    expect(headless.vision).toBeNull();
    for (const entity of headless.entities) {
      expect(isVisibleTo(headless.vision, entity)).toBe(true);
    }
  });
});

describe('remembered ground and ghosts', () => {
  it('marks tiles around the lance as visible and explored', () => {
    updateVision(world, world.vision!);
    const tile = world.terrain.toTile(scout.pos);
    const cell = tile.row * world.terrain.width + tile.column;

    expect(tileVisible(world.vision, cell)).toBe(true);
    expect(tileExplored(world.vision, cell)).toBe(true);
  });

  it('keeps ground explored after the lance moves away', () => {
    updateVision(world, world.vision!);
    const tile = world.terrain.toTile(scout.pos);
    const cell = tile.row * world.terrain.width + tile.column;

    // Far enough that the tile is outside every mech's reach, including the
    // longest-sighted pilot in the lance.
    const reach = Math.max(...world.entities.map((entity) => entity.sensorRange));
    for (const entity of world.entities) {
      if (entity.team === 0) entity.pos = { x: scout.pos.x + reach * 2, y: 12 };
    }
    updateVision(world, world.vision!);

    expect(tileVisible(world.vision, cell)).toBe(false);
    expect(tileExplored(world.vision, cell)).toBe(true);
  });

  it('records a ghost at the last known position', () => {
    scout.pos = { x: 500, y: 12 };
    enemy.pos = { x: 620, y: 12 };
    updateVision(world, world.vision!);

    const ghost = world.vision!.ghosts.get(enemy.id);
    expect(ghost?.pos).toEqual({ x: 620, y: 12 });

    enemy.pos = { x: 5000, y: 5000 };
    updateVision(world, world.vision!);

    expect(world.vision!.visible.has(enemy.id)).toBe(false);
    expect(world.vision!.ghosts.get(enemy.id)?.pos).toEqual({ x: 620, y: 12 });
  });

  it('forgets a ghost once the memory window lapses', () => {
    scout.pos = { x: 500, y: 12 };
    enemy.pos = { x: 620, y: 12 };
    updateVision(world, world.vision!);
    expect(world.vision!.ghosts.has(enemy.id)).toBe(true);

    enemy.pos = { x: 5000, y: 5000 };
    world.tick += catalog.rules.sensors.ghostMemorySeconds / world.dt + 10;
    updateVision(world, world.vision!);

    expect(world.vision!.ghosts.has(enemy.id)).toBe(false);
  });
});

describe('signature', () => {
  it('makes a heavier hull easier to pick up', () => {
    const rules = catalog.rules.sensors;
    expect(signatureFor(rules, 100)).toBeGreaterThan(signatureFor(rules, 25));
  });

  it('stamps a smaller signature on a mech built to hide', () => {
    // The Wisp carries narrow_profile; the Bulwark is a wall with legs.
    const wisp = world.entities.find((entity) => entity.chassisId === 'wisp_wsp1');
    const bulwark = world.entities.find((entity) => entity.chassisId === 'bulwark_bwk3');
    if (wisp === undefined || bulwark === undefined) return;
    expect(wisp.signature).toBeLessThan(bulwark.signature * 0.8);
  });

  it('lets a scout walk closer than an assault hull before either is seen', () => {
    const vision = world.vision!;
    // One observer, two identical approaches, two different hulls.
    for (const entity of world.entities) {
      if (entity !== scout) entity.destroyed = entity.team === 0;
    }
    scout.pos = { x: 100, y: 100 };

    const reachOf = (target: MechEntity): number => {
      let seen = 0;
      for (let gap = 40; gap < 1_400; gap += 20) {
        target.pos = { x: 100 + gap, y: 100 };
        updateVision(world, vision);
        if (vision.visible.has(target.id)) seen = gap;
        else break;
      }
      return seen;
    };

    const small = world.entities.find((e) => e.chassisId === 'wisp_wsp1' && e.team !== 0);
    const large = world.entities.find((e) => e.chassisId === 'bulwark_bwk3' && e.team !== 0);
    if (small === undefined || large === undefined) return;
    small.destroyed = false;
    large.destroyed = false;
    // Park the one not under test far away so it cannot be the contact seen.
    large.pos = { x: 5_000, y: 5_000 };
    const scoutReach = reachOf(small);
    small.pos = { x: 5_000, y: 5_000 };
    const assaultReach = reachOf(large);

    expect(scoutReach).toBeGreaterThan(0);
    expect(scoutReach).toBeLessThan(assaultReach);
  });

  it('holds a distant contact without naming it', () => {
    const vision = world.vision!;
    scout.pos = { x: 100, y: 100 };
    const reach = scout.sensorRange * enemy.signature;
    const identify = catalog.rules.sensors.identifyFraction;

    // Walk in from the edge of detection to the first spot the scout actually
    // holds — ridge_pass has terrain in the way, and which spot that is
    // matters less than what the lance knows once it gets there.
    let held: number | null = null;
    for (let f = 0.95; f > identify + 0.05; f -= 0.05) {
      enemy.pos = { x: 100 + reach * f, y: 100 };
      updateVision(world, vision);
      if (isVisibleTo(vision, enemy)) {
        held = f;
        break;
      }
    }

    expect(held, 'the scout never picked the contact up at all').not.toBeNull();
    expect(isIdentifiedBy(vision, enemy), 'named a contact out past identification range').toBe(
      false,
    );

    enemy.pos = { x: 100 + reach * 0.3, y: 100 };
    updateVision(world, vision);
    expect(isIdentifiedBy(vision, enemy)).toBe(true);
  });
});
