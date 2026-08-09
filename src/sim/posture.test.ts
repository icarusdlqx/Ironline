import { beforeEach, describe, expect, it } from 'vitest';
import { playerWorld, spawnDesign } from '../../tests/support';
import { resolveProjectiles } from './combat';
import { distance } from './math';
import { isRooted, issueAttack, issueMove, setPosture, updatePlayerControl } from './orders';
import { updateVision } from './sensors';
import type { MechEntity, World } from './types';
import { stepWorld } from './world';

const MAX_TICKS = 12_000;

function run(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks && !world.finished; tick += 1) stepWorld(world, MAX_TICKS);
}

/**
 * A stretch of open ground: a row with clear tiles far enough apart to walk
 * between. Dropping a mech on a rock gives it a terrain multiplier of zero,
 * and then nothing in these tests moves for reasons that have nothing to do
 * with the postures under test.
 */
function openLane(world: World): { west: number; east: number; y: number } {
  const { terrain } = world;
  for (let row = 2; row < terrain.height - 2; row += 1) {
    const open: number[] = [];
    for (let column = 1; column < terrain.width - 1; column += 1) {
      if (terrain.passable(column, row)) open.push(column);
    }
    const first = open[0];
    const last = open[open.length - 1];
    if (first === undefined || last === undefined || last - first < 12) continue;
    if (!open.every((column, index) => index === 0 || column === (open[index - 1] ?? 0) + 1)) {
      continue;
    }
    return {
      west: terrain.tileCentre(first + 1, row).x,
      east: terrain.tileCentre(last - 1, row).x,
      y: terrain.tileCentre(first, row).y,
    };
  }
  throw new Error('this map has no open lane to test movement in');
}

let world: World;
let mech: MechEntity;
let foe: MechEntity;
let lane: { west: number; east: number; y: number };

function build(seed: string): { world: World; mech: MechEntity; foe: MechEntity } {
  const built = playerWorld(seed);
  for (const entity of built.entities) entity.destroyed = true;

  const open = openLane(built);
  const middle = (open.west + open.east) / 2;
  const unit = spawnDesign(built, 'sentinel_brawler', 0, { x: middle, y: open.y });
  const enemy = spawnDesign(built, 'rampart_breaker', 1, { x: open.east, y: open.y });

  for (const entity of [unit, enemy]) {
    entity.controller = 'orders';
    entity.autopilot = false;
  }
  unit.facing = 0;
  return { world: built, mech: unit, foe: enemy };
}

beforeEach(() => {
  const built = build('posture');
  world = built.world;
  mech = built.mech;
  foe = built.foe;
  lane = openLane(world);
});

describe('hold position', () => {
  it('roots the mech and drops whatever it was walking towards', () => {
    issueMove(world, mech, { x: lane.east, y: lane.y }, false);
    expect(mech.orders.move).not.toBeNull();

    setPosture(mech, 'hold_position');
    expect(isRooted(mech)).toBe(true);
    expect(mech.orders.move).toBeNull();
    expect(mech.path).toHaveLength(0);

    const start = { ...mech.pos };
    run(world, 60);
    expect(distance(start, mech.pos)).toBeLessThan(1);
  });

  it('still shoots at what it can reach', () => {
    // Auto-acquisition only sees what the lance's sensors see.
    if (world.vision !== null) updateVision(world, world.vision);

    setPosture(mech, 'hold_position');
    updatePlayerControl(world, mech);
    expect(mech.targetId).toBe(foe.id);
  });

  it('is released by a move order, because the pilot was just told to go', () => {
    setPosture(mech, 'hold_position');
    expect(issueMove(world, mech, { x: lane.east, y: lane.y }, false)).toBe(true);
    expect(mech.posture).toBe('free');
    expect(isRooted(mech)).toBe(false);
  });
});

describe('return fire', () => {
  it('holds its fire until something shoots at it', () => {
    setPosture(mech, 'return_fire');
    updatePlayerControl(world, mech);
    expect(mech.targetId).toBeNull();
  });

  it('shoots back at whoever put fire on it, hit or miss', () => {
    setPosture(mech, 'return_fire');

    world.projectiles.push({
      shooterId: foe.id,
      targetId: mech.id,
      weaponId: 'ac5',
      hit: false,
      from: { ...foe.pos },
      calledShot: null,
      damage: 5,
      impactTick: world.tick,
    });
    resolveProjectiles(world);

    updatePlayerControl(world, mech);
    expect(mech.targetId).toBe(foe.id);
  });

  it('goes quiet again once the memory of being shot at runs out', () => {
    setPosture(mech, 'return_fire');
    mech.threatenedBy = foe.id;
    mech.threatenedUntilTick = world.tick;

    world.tick += 1;
    updatePlayerControl(world, mech);
    expect(mech.targetId).toBeNull();
  });

  it('still obeys an explicit attack order', () => {
    setPosture(mech, 'return_fire');
    issueAttack(mech, foe.id, null);
    updatePlayerControl(world, mech);
    expect(mech.targetId).toBe(foe.id);
  });
});

describe('keep facing', () => {
  it('holds the nose on the target while it repositions', () => {
    mech.targetId = foe.id;
    setPosture(mech, 'keep_facing');
    // Walk away from the enemy: an ordinary march would turn its back.
    const start = mech.pos.x;
    issueMove(world, mech, { x: lane.west, y: lane.y }, false);

    run(world, 40);

    const toFoe = Math.atan2(foe.pos.y - mech.pos.y, foe.pos.x - mech.pos.x);
    const off = Math.abs(Math.atan2(Math.sin(mech.facing - toFoe), Math.cos(mech.facing - toFoe)));
    expect(off, 'the mech turned its back on the target').toBeLessThan(0.35);
    expect(mech.pos.x, 'the mech never withdrew').toBeLessThan(start);
  });

  it('survives a move order, because moving is the point of it', () => {
    setPosture(mech, 'keep_facing');
    issueMove(world, mech, { x: lane.east, y: lane.y }, false);
    expect(mech.posture).toBe('keep_facing');
  });

  it('pays for crabbing in pace', () => {
    mech.targetId = foe.id;
    setPosture(mech, 'keep_facing');
    const start = mech.pos.x;
    issueMove(world, mech, { x: lane.west, y: lane.y }, false);
    run(world, 60);
    const crabbed = start - mech.pos.x;

    // The same withdrawal with the hull free to turn covers more ground.
    const second = build('posture');
    issueMove(second.world, second.mech, { x: lane.west, y: lane.y }, false);
    run(second.world, 60);
    const marched = start - second.mech.pos.x;

    expect(crabbed).toBeGreaterThan(0);
    expect(crabbed).toBeLessThan(marched);
  });

  it('marches normally with nothing to face', () => {
    mech.targetId = null;
    foe.destroyed = true;
    setPosture(mech, 'keep_facing');
    const start = mech.pos.x;
    issueMove(world, mech, { x: lane.east, y: lane.y }, false);
    run(world, 30);
    expect(mech.pos.x).toBeGreaterThan(start);
  });
});
