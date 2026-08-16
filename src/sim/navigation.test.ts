import { describe, expect, it } from 'vitest';
import { makeGrid, OPEN_LEGEND, playerWorld } from '../../tests/support';
import { bodyRadius } from './collision';
import { distance } from './math';
import { updateMovement } from './movement';
import { issueMove, issueStop } from './orders';
import { findPath } from './pathfind';
import type { MechEntity, World } from './types';
import { stepWorld } from './world';

/** Open ground with clear tiles on every side, away from the map edge. */
function openGround(world: World): { x: number; y: number } {
  const { terrain } = world;
  for (let row = 4; row < terrain.height - 4; row += 1) {
    for (let column = 4; column < terrain.width - 4; column += 1) {
      if (terrain.typeAt(column, row).moveMultiplier < 1) continue;
      const clear = [-2, -1, 0, 1, 2].every((dx) =>
        [-2, -1, 0, 1, 2].every((dy) => terrain.passable(column + dx, row + dy)),
      );
      if (clear) return terrain.tileCentre(column, row);
    }
  }
  throw new Error('this map has no open ground');
}

function playerPair(world: World): [MechEntity, MechEntity] {
  const mine = world.entities.filter((entity) => entity.team === 0);
  const [a, b] = mine;
  if (a === undefined || b === undefined) throw new Error('need two player mechs');
  return [a, b];
}

describe('paths to unreachable ground', () => {
  const walled = makeGrid({
    tiles: [
      '..........',
      '..........',
      '....##....',
      '....##....',
      '....##....',
      '....##....',
      '....##....',
      '....##....',
      '..........',
      '..........',
    ],
    legend: OPEN_LEGEND,
    tileSize: 10,
  });

  it('still routes round a wall with open ends', () => {
    const path = findPath(walled, { x: 15, y: 45 }, { x: 85, y: 45 }, 4000);
    expect(path).not.toBeNull();
    const last = (path ?? [])[(path ?? []).length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) expect(distance(last, { x: 85, y: 45 })).toBeLessThan(10);
  });

  it('walks to the near bank when the goal is sealed off', () => {
    const sealed = makeGrid({
      tiles: [
        '..........',
        '.########.',
        '.#......#.',
        '.#......#.',
        '.########.',
        '..........',
        '..........',
        '..........',
        '..........',
        '..........',
      ],
      legend: OPEN_LEGEND,
      tileSize: 10,
    });
    // The courtyard interior cannot be entered; asking for its centre should
    // still produce a march to the wall, not a refusal.
    const path = findPath(sealed, { x: 55, y: 85 }, { x: 45, y: 30 }, 4000);
    expect(path).not.toBeNull();
    const last = (path ?? [])[(path ?? []).length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) {
      const tile = sealed.toTile(last);
      expect(sealed.passable(tile.column, tile.row)).toBe(true);
    }
  });
});

describe('orders that end on occupied or unreachable ground', () => {
  it('completes instead of looping when the destination is under a lance-mate', () => {
    const world = playerWorld('blocked-destination');
    const [walker, blocker] = playerPair(world);
    const spot = openGround(world);

    blocker.pos = { ...spot };
    issueStop(blocker);
    blocker.posture = 'hold_position';

    // The walker starts from its own spawn — guaranteed in bounds — and is
    // sent to the exact ground the blocker is parked on.
    expect(issueMove(world, walker, spot, false)).toBe(true);

    // Long enough for the walk, the shove-stall against the blocker, and the
    // give-up — the bug this pins was an endless loop, so the order must be
    // GONE, with the walker parked hard against the machine on the spot.
    for (let tick = 0; tick < 1_000 && walker.orders.move !== null; tick += 1) {
      stepWorld(world, 12_000);
    }

    expect(walker.orders.move).toBeNull();
    expect(distance(walker.pos, spot)).toBeLessThan(
      world.rules.movement.arrivalRadius + 3 * bodyRadius(world, walker),
    );
  });

  it('drops the order after repeated stalls instead of headbutting forever', () => {
    const world = playerWorld('hopeless');
    const [walker] = playerPair(world);
    walker.stallStrikes = 3;
    const away = { x: walker.pos.x + 300, y: walker.pos.y };
    walker.orders.move = { to: away, run: false };

    stepWorld(world, 12_000);

    expect(walker.orders.move).toBeNull();
  });
});

describe('waypoint recovery', () => {
  it('skips a waypoint it has been shoved past', () => {
    const world = playerWorld('skip');
    const [walker] = playerPair(world);
    const spot = openGround(world);

    // Standing at the second waypoint exactly; the first is 60m behind it.
    walker.pos = { x: spot.x, y: spot.y };
    walker.path = [
      { x: spot.x - 60, y: spot.y },
      { x: spot.x + 2, y: spot.y },
    ];
    walker.pathIndex = 0;
    walker.orders.move = { to: { x: spot.x + 2, y: spot.y }, run: false };

    updateMovement(world, walker);

    // Either the index moved on, or the skip let the whole walk finish on the
    // spot (clearPath resets the index) — what must NOT happen is a march
    // back west to touch the first waypoint.
    const advanced = walker.pathIndex >= 1 || walker.path.length === 0;
    expect(advanced).toBe(true);
    expect(walker.pos.x).toBeGreaterThan(spot.x - 2);
  });
});

describe('an order the player can see land', () => {
  it('keeps the route of a fresh order given to a mech that was wedged', () => {
    const world = playerWorld('stale-counters');
    const [walker] = playerPair(world);

    // Exactly the state a machine carries after being shouldered off its line
    // by a lance-mate: it has stalled, and the closest it ever got to the old
    // waypoint is a bar the new order cannot possibly clear on its first tick.
    walker.stalledTicks = world.rules.movement.stallTicks + 20;
    walker.closestApproach = 3;

    const away = { x: walker.pos.x + 220, y: walker.pos.y + 160 };
    expect(issueMove(world, walker, away, false)).toBe(true);
    expect(walker.path.length).toBeGreaterThan(0);

    // The very first movement ticks must not mistake a brand-new walk for the
    // continuation of the stalled one and wipe the route before it is drawn.
    for (let tick = 0; tick < 5; tick += 1) updateMovement(world, walker);
    expect(walker.path.length).toBeGreaterThan(0);
    expect(walker.orders.move).not.toBeNull();
  });

  it('does not discard an order to open ground near a mech that once stalled', () => {
    const world = playerWorld('near-ground');
    const [walker, other] = playerPair(world);
    const spot = openGround(world);

    // The walker carries a strike, and the destination is a few body-widths
    // away — but nothing is standing on it, so the order is real work.
    walker.pos = { x: spot.x - 90, y: spot.y };
    other.pos = { x: spot.x + 400, y: spot.y + 400 };
    issueStop(other);
    expect(issueMove(world, walker, spot, false)).toBe(true);
    walker.stallStrikes = 1;

    stepWorld(world, 12_000);

    expect(walker.orders.move, 'an order to empty ground was thrown away').not.toBeNull();
  });

  it('says so out loud when a route is abandoned as hopeless', () => {
    const world = playerWorld('hopeless-speaks');
    const [walker] = playerPair(world);
    walker.autopilot = false;
    walker.stallStrikes = 3;
    walker.orders.move = { to: { x: walker.pos.x + 300, y: walker.pos.y }, run: false };

    stepWorld(world, 12_000);

    const said = world.events.some(
      (event) => event.type === 'mission_message' && String(event.text).includes('cannot find a way'),
    );
    expect(walker.orders.move).toBeNull();
    expect(said, 'the order vanished without telling the player').toBe(true);
  });
});
