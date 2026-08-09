import { beforeEach, describe, expect, it } from 'vitest';
import { catalog, playerWorld, spawnDesign } from '../../tests/support';
import { eventsOfType } from './events';
import { distance } from './math';
import { canJump, issueJump, issueMove } from './orders';
import { jumpHeight } from './movement';
import type { MechEntity, World } from './types';
import { stepWorld } from './world';

const MAX_TICKS = 12_000;

function run(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks && !world.finished; tick += 1) stepWorld(world, MAX_TICKS);
}

/** Flies whatever arc is in the air to its landing, and reports the ticks taken. */
function land(world: World, mech: MechEntity): number {
  let ticks = 0;
  while (mech.jump !== null && ticks < 200) {
    stepWorld(world, MAX_TICKS);
    ticks += 1;
  }
  return ticks;
}

let world: World;
let jumper: MechEntity;
let grounded: MechEntity;

beforeEach(() => {
  world = playerWorld('jump');
  // wisp_scout carries jets on a jump-capable chassis; rampart_breaker has none.
  jumper = spawnDesign(world, 'wisp_scout', 0, { x: 300, y: 300 });
  grounded = spawnDesign(world, 'rampart_breaker', 0, { x: 400, y: 300 });
  for (const entity of [jumper, grounded]) {
    entity.controller = 'orders';
    entity.autopilot = false;
  }
});

describe('jump jets', () => {
  it('gives a jump-capable mech the reach its jets are worth', () => {
    const jets = catalog.designs
      .get('wisp_scout')
      ?.equipment.filter((fit) => fit.equipmentId === 'jump_jet').length;
    expect(jets ?? 0).toBeGreaterThan(0);
    expect(jumper.jumpRange).toBe((jets ?? 0) * catalog.rules.movement.jumpDistancePerJet);
    expect(jumper.jumpHeat).toBe((jets ?? 0) * catalog.rules.movement.jumpHeatPerJet);
  });

  it('gives nothing to a mech with no jets', () => {
    expect(grounded.jumpRange).toBe(0);
    expect(canJump(grounded)).toBe(false);
    expect(issueJump(world, grounded, { x: 420, y: 300 })).toBe(false);
  });

  it('lands where it was told and charges heat for the trip', () => {
    const to = { x: jumper.pos.x + 40, y: jumper.pos.y };
    const heatBefore = jumper.heat;

    expect(issueJump(world, jumper, to)).toBe(true);
    expect(jumper.heat).toBeGreaterThan(heatBefore);
    expect(jumper.motion).toBe('jump');

    const ticks = land(world, jumper);
    expect(ticks, 'the arc never finished').toBeGreaterThan(0);
    expect(distance(jumper.pos, to)).toBeLessThan(1);
    expect(jumper.motion).toBe('stationary');
  });

  it('clamps a jump beyond its reach instead of refusing it', () => {
    const start = { ...jumper.pos };
    expect(issueJump(world, jumper, { x: start.x + 5_000, y: start.y })).toBe(true);
    land(world, jumper);
    expect(distance(start, jumper.pos)).toBeCloseTo(jumper.jumpRange, 3);
  });

  it('leaves the ground and comes back to it', () => {
    issueJump(world, jumper, { x: jumper.pos.x + 60, y: jumper.pos.y });
    let peak = 0;
    while (jumper.jump !== null) {
      peak = Math.max(peak, jumpHeight(jumper));
      stepWorld(world, MAX_TICKS);
    }
    expect(peak, 'the mech never left the ground').toBeGreaterThan(0.5);
    expect(jumpHeight(jumper)).toBe(0);
  });

  it('will not fire again until the jets recharge', () => {
    issueJump(world, jumper, { x: jumper.pos.x + 30, y: jumper.pos.y });
    land(world, jumper);

    expect(canJump(jumper)).toBe(false);
    expect(issueJump(world, jumper, { x: jumper.pos.x + 30, y: jumper.pos.y })).toBe(false);

    run(world, Math.ceil(catalog.rules.movement.jumpCooldownSeconds / world.dt) + 2);
    expect(canJump(jumper)).toBe(true);
  });

  it('abandons the move order it was walking, rather than resuming mid-air', () => {
    issueMove(world, jumper, { x: jumper.pos.x + 200, y: jumper.pos.y }, false);
    expect(jumper.orders.move).not.toBeNull();

    issueJump(world, jumper, { x: jumper.pos.x + 30, y: jumper.pos.y });
    expect(jumper.orders.move).toBeNull();
    expect(jumper.path).toHaveLength(0);
  });

  it('reports the take-off and the landing so the renderer can show both', () => {
    issueJump(world, jumper, { x: jumper.pos.x + 40, y: jumper.pos.y });
    land(world, jumper);

    expect(eventsOfType(world.events, 'jump_started')).toHaveLength(1);
    expect(eventsOfType(world.events, 'jump_landed')).toHaveLength(1);
  });

  it('will not come down on ground it cannot stand on', () => {
    const { terrain } = world;
    let blocked: { x: number; y: number } | null = null;
    let stand: { x: number; y: number } | null = null;

    for (let row = 1; row < terrain.height - 1 && blocked === null; row += 1) {
      for (let column = 1; column < terrain.width - 1; column += 1) {
        if (terrain.passable(column, row) || !terrain.passable(column - 1, row)) continue;
        blocked = terrain.tileCentre(column, row);
        stand = terrain.tileCentre(column - 1, row);
        break;
      }
    }

    expect(blocked, 'this map has no impassable tile to test against').not.toBeNull();
    if (blocked === null || stand === null) return;

    jumper.pos = stand;
    expect(issueJump(world, jumper, blocked)).toBe(false);
    expect(jumper.jump).toBeNull();
  });

  it('clamps toward an unreachable aim point without landing in a wall', () => {
    // Pointing miles past the ridge means "clear it", so the order is taken and
    // shortened — but only if the shortened landing is somewhere to stand.
    const start = { ...jumper.pos };
    expect(issueJump(world, jumper, { x: start.x + 5_000, y: start.y })).toBe(true);
    land(world, jumper);
    const tile = world.terrain.toTile(jumper.pos);
    expect(world.terrain.passable(tile.column, tile.row)).toBe(true);
  });

  it('is harder to hit and shoots worse while airborne', () => {
    const rules = world.rules.combat;
    expect(rules.targetMotion.jump).toBeLessThan(rules.targetMotion.run);
    expect(rules.shooterMotion.jump).toBeLessThan(rules.shooterMotion.run);
  });
});
