import { beforeEach, describe, expect, it } from 'vitest';
import { playerWorld, unitOf } from '../../tests/support';
import {
  isHoldingFire,
  issueAttack,
  issueMove,
  issueStop,
  setGroupEnabled,
  setHoldFire,
  updatePlayerControl,
} from './orders';
import { eventsOfType } from './events';
import { updateVision } from './sensors';
import { isOperational, type MechEntity, type World } from './types';
import { stepWorld } from './world';

let world: World;
let mech: MechEntity;

// Energy weapons resolve on the tick they fire, so only the event stream records every shot.
function shotsBy(active: World, shooterId: number): string[] {
  return eventsOfType(active.events, 'weapon_fired')
    .filter((event) => event.shooterId === shooterId)
    .map((event) => event.weaponId);
}

beforeEach(() => {
  world = playerWorld('orders');
  mech = unitOf(world, 'sentinel_brawler');
});

describe('control assignment', () => {
  it('puts the player team under order control and the rest on autopilot', () => {
    for (const entity of world.entities) {
      expect(entity.autopilot).toBe(entity.team !== 0);
    }
  });

  it('leaves every unit on autopilot when there is no player team', () => {
    const headless = playerWorld('headless', 9);
    expect(headless.entities.every((entity) => entity.autopilot)).toBe(true);
  });
});

describe('issueMove', () => {
  it('plans a path and records the order', () => {
    const ok = issueMove(world, mech, { x: 400, y: 600 }, false);
    expect(ok).toBe(true);
    expect(mech.orders.move?.to).toEqual({ x: 400, y: 600 });
    expect(mech.path.length).toBeGreaterThan(0);
    expect(mech.motion).toBe('walk');
  });

  it('marks the mech as running when ordered to run', () => {
    issueMove(world, mech, { x: 400, y: 600 }, true);
    expect(mech.motion).toBe('run');
  });

  it('refuses an order to a destination with no route', () => {
    const walled = playerWorld('walled');
    const target = unitOf(walled, 'sentinel_brawler');
    const ok = issueMove(walled, target, { x: 1_000_000, y: 1_000_000 }, false);
    expect(ok).toBe(false);
    expect(target.orders.move).toBeNull();
  });

  it('clears the order once the mech arrives', () => {
    issueMove(world, mech, { x: 400, y: 600 }, false);
    mech.pos = { x: 400, y: 600 };
    updatePlayerControl(world, mech);
    expect(mech.orders.move).toBeNull();
    expect(mech.motion).toBe('stationary');
  });

  it('is cancelled by a stop order', () => {
    issueMove(world, mech, { x: 400, y: 600 }, false);
    issueStop(mech);
    expect(mech.orders.move).toBeNull();
    expect(mech.path).toHaveLength(0);
    expect(mech.motion).toBe('stationary');
  });
});

describe('targeting', () => {
  it('holds an ordered target even when a closer enemy exists', () => {
    const enemies = world.entities.filter((entity) => entity.team === 1);
    const far = enemies[enemies.length - 1];
    const near = enemies[0];
    expect(far).toBeDefined();
    expect(near).toBeDefined();

    near!.pos = { x: mech.pos.x + 30, y: mech.pos.y };
    issueAttack(mech, far!.id, null);
    updatePlayerControl(world, mech);

    expect(mech.targetId).toBe(far!.id);
  });

  it('drops the order and reacquires when the ordered target dies', () => {
    const enemy = world.entities.find((entity) => entity.team === 1);
    expect(enemy).toBeDefined();

    issueAttack(mech, enemy!.id, null);
    enemy!.destroyed = true;
    updatePlayerControl(world, mech);

    expect(mech.orders.attack).toBeNull();
    expect(mech.targetId).not.toBe(enemy!.id);
  });

  it('auto-acquires the nearest visible enemy', () => {
    const enemy = world.entities.find((entity) => entity.team === 1);
    expect(enemy).toBeDefined();
    enemy!.pos = { x: mech.pos.x + 60, y: mech.pos.y };
    if (world.vision !== null) updateVision(world, world.vision);

    updatePlayerControl(world, mech);
    expect(mech.targetId).toBe(enemy!.id);
  });

  it('does not auto-acquire an enemy hidden by fog', () => {
    updatePlayerControl(world, mech);
    const visible = world.vision?.visible.size ?? 0;
    if (visible === 0) expect(mech.targetId).toBeNull();
    else expect(world.vision?.visible.has(mech.targetId ?? -1)).toBe(true);
  });

  it('carries a called shot through to the entity', () => {
    const enemy = world.entities.find((entity) => entity.team === 1);
    issueAttack(mech, enemy!.id, 'left_leg');
    updatePlayerControl(world, mech);
    expect(mech.calledShot).toBe('left_leg');
  });
});

describe('weapon groups', () => {
  it('starts with every group live', () => {
    expect(mech.groupEnabled.every((enabled) => enabled)).toBe(true);
    expect(isHoldingFire(mech)).toBe(false);
  });

  it('toggles a single group', () => {
    setGroupEnabled(mech, 2, false);
    expect(mech.groupEnabled[1]).toBe(false);
    expect(isHoldingFire(mech)).toBe(false);
  });

  it('ignores a group index outside 1-4', () => {
    setGroupEnabled(mech, 9, false);
    expect(mech.groupEnabled).toHaveLength(4);
    expect(mech.groupEnabled.every((enabled) => enabled)).toBe(true);
  });

  it('holds fire by disabling every group, and clears the target', () => {
    setHoldFire(mech, true);
    expect(isHoldingFire(mech)).toBe(true);

    updatePlayerControl(world, mech);
    expect(mech.targetId).toBeNull();

    setHoldFire(mech, false);
    expect(isHoldingFire(mech)).toBe(false);
  });

  it('stops a held group from firing', () => {
    const enemy = world.entities.find((entity) => entity.team === 1);
    expect(enemy).toBeDefined();

    mech.pos = { x: 500, y: 500 };
    enemy!.pos = { x: 560, y: 500 };
    mech.facing = 0;
    mech.targetId = enemy!.id;
    setHoldFire(mech, true);

    stepWorld(world, 100);
    expect(shotsBy(world, mech.id)).toHaveLength(0);
  });

  it('lets a live group fire while a held group stays silent', () => {
    const enemy = world.entities.find((entity) => entity.team === 1);
    expect(enemy).toBeDefined();

    mech.pos = { x: 500, y: 500 };
    enemy!.pos = { x: 560, y: 500 };
    mech.facing = 0;
    mech.targetId = enemy!.id;

    setGroupEnabled(mech, 2, false);
    setGroupEnabled(mech, 3, false);
    stepWorld(world, 100);

    const fired = shotsBy(world, mech.id);
    expect(fired.length).toBeGreaterThan(0);
    for (const weaponId of fired) {
      expect(world.catalog.weapons.get(weaponId)?.type).toBe('energy');
    }
  });
});

describe('player units under stepWorld', () => {
  it('are not steered by the placeholder AI', () => {
    issueMove(world, mech, { x: mech.pos.x + 200, y: mech.pos.y - 200 }, false);
    const destination = { ...mech.orders.move!.to };

    for (let tick = 0; tick < 40; tick += 1) stepWorld(world, 6000);

    expect(mech.orders.move?.to).toEqual(destination);
    expect(isOperational(mech)).toBe(true);
  });
});
