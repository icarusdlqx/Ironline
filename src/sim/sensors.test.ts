import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, playerWorld, testWorld, unitOf } from '../../tests/support';
import { isVisibleTo, sensorRangeFor, tileExplored, tileVisible, updateVision } from './sensors';
import type { MechEntity, World } from './types';

let world: World;
let scout: MechEntity;
let enemy: MechEntity;

beforeEach(() => {
  world = playerWorld('sensors');
  scout = unitOf(world, 'wisp_scout');
  enemy = unitOf(world, 'bulwark_burner');
});

describe('sensorRangeFor', () => {
  it('grows with the sensors skill', () => {
    const rules = catalog.rules.sensors;
    expect(sensorRangeFor(rules, 1)).toBe(rules.baseRange + rules.rangePerSkill);
    expect(sensorRangeFor(rules, 5)).toBeGreaterThan(sensorRangeFor(rules, 2));
  });

  it('is stamped onto each mech at spawn', () => {
    for (const entity of world.entities) {
      expect(entity.sensorRange).toBe(sensorRangeFor(catalog.rules.sensors, entity.pilot.sensors));
    }
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

    for (const entity of world.entities) {
      if (entity.team === 0) entity.pos = { x: 500, y: 12 };
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
