import { describe, expect, it } from 'vitest';
import { playerWorld } from '../../tests/support';
import { distance } from './math';
import { issueMove } from './orders';
import type { MechEntity, World } from './types';
import { stepWorld } from './world';

function setup(seed: string): { world: World; mech: MechEntity; foe: MechEntity } {
  const world = playerWorld(seed);
  const mine = world.entities.filter((entity) => entity.team === 0);
  const foes = world.entities.filter((entity) => entity.team !== 0);
  const mech = mine[0];
  const foe = foes[0];
  if (mech === undefined || foe === undefined) throw new Error('mission too small');

  // Everyone else out of the fight, so the two under test are all that matters.
  for (const entity of world.entities) {
    if (entity !== mech && entity !== foe) entity.destroyed = true;
  }
  mech.controller = 'orders';
  mech.autopilot = false;
  foe.controller = 'orders';
  foe.autopilot = false;
  return { world, mech, foe };
}

function run(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks && !world.finished; tick += 1) stepWorld(world, 12_000);
}

describe('attack-move', () => {
  it('walks the whole way when nothing shows itself', () => {
    const { world, mech, foe } = setup('am-clear');
    // Parked out of sensor reach, not dead: a dead lance ends the battle and
    // the world stops stepping, which would pass this test for free.
    foe.pos = { x: 24, y: 24 };

    const goal = { x: mech.pos.x + 150, y: mech.pos.y };
    issueMove(world, mech, goal, false, { engage: true });
    run(world, 700);

    expect(distance(mech.pos, goal)).toBeLessThan(world.rules.movement.arrivalRadius * 2);
  });

  it('stops to fight a contact inside weapon reach, keeping the order', () => {
    const { world, mech, foe } = setup('am-contact');

    // Park the enemy squarely on the route, inside the mech's longest gun.
    foe.pos = { x: mech.pos.x + 120, y: mech.pos.y };

    const goal = { x: mech.pos.x + 500, y: mech.pos.y };
    issueMove(world, mech, goal, false, { engage: true });
    run(world, 120);

    expect(mech.motion, 'kept marching past a live contact').toBe('stationary');
    expect(mech.orders.move, 'threw the destination away').not.toBeNull();
    expect(mech.targetId).toBe(foe.id);
  });

  it('resumes the advance once the contact is dead', () => {
    const { world, mech, foe } = setup('am-resume');
    foe.pos = { x: mech.pos.x + 120, y: mech.pos.y };

    const goal = { x: mech.pos.x + 300, y: mech.pos.y };
    issueMove(world, mech, goal, false, { engage: true });
    run(world, 60);
    expect(mech.motion).toBe('stationary');

    // The contact breaks off rather than dying — a kill would end the battle.
    foe.pos = { x: 24, y: 24 };
    run(world, 900);
    expect(distance(mech.pos, goal)).toBeLessThan(world.rules.movement.arrivalRadius * 3);
  });
});

describe('waypoint queue', () => {
  it('walks queued legs in order and finishes at the last one', () => {
    const { world, mech, foe } = setup('wp');
    foe.pos = { x: 24, y: 24 };

    const first = { x: mech.pos.x + 100, y: mech.pos.y };
    const second = { x: mech.pos.x + 100, y: mech.pos.y + 90 };
    issueMove(world, mech, first, false);
    issueMove(world, mech, second, false, { queued: true });
    expect(mech.orders.queue).toHaveLength(1);

    run(world, 1_400);
    expect(distance(mech.pos, second)).toBeLessThan(world.rules.movement.arrivalRadius * 3);
    expect(mech.orders.queue).toHaveLength(0);
  });

  it('drops the queue when a plain move replaces the route', () => {
    const { world, mech, foe } = setup('wp-replace');
    foe.pos = { x: 24, y: 24 };

    issueMove(world, mech, { x: mech.pos.x + 100, y: mech.pos.y }, false);
    issueMove(world, mech, { x: mech.pos.x + 100, y: mech.pos.y + 90 }, false, { queued: true });
    issueMove(world, mech, { x: mech.pos.x + 40, y: mech.pos.y }, false);

    expect(mech.orders.queue, 'a fresh order should clear the stale route').toHaveLength(0);
  });
});
