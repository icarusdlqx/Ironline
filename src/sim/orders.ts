import type { MechLocation } from '../schema/common';
import { applyHeatGovernor } from './governor';
import { distance } from './math';
import { beginJump } from './movement';
import { findPath } from './pathfind';
import { isVisibleTo } from './sensors';
import {
  findEntity,
  isImmobile,
  isDown,
  isOperational,
  type EntityId,
  type MechEntity,
  type Posture,
  type Vec2,
  type World,
} from './types';

export interface MoveOrder {
  to: Vec2;
  run: boolean;
  /** Attack-move: stop and fight whatever shows itself, then carry on. */
  engage?: boolean;
}

export interface AttackOrder {
  targetId: EntityId;
  calledShot: MechLocation | null;
}

export interface OrderState {
  move: MoveOrder | null;
  attack: AttackOrder | null;
  /** Legs of a queued route, walked in order as each move completes. */
  queue: MoveOrder[];
}

export function emptyOrders(): OrderState {
  return { move: null, attack: null, queue: [] };
}

/** True while the stance has the mech rooted to the ground it is standing on. */
export function isRooted(entity: MechEntity): boolean {
  return entity.posture === 'hold_position' || entity.posture === 'return_fire';
}

export function setPosture(entity: MechEntity, posture: Posture): void {
  entity.posture = posture;
  if (!isRooted(entity)) return;

  // Told to hold this ground: whatever it was walking towards is cancelled.
  entity.orders.move = null;
  entity.path = [];
  entity.pathIndex = 0;
  entity.motion = 'stationary';
  entity.intendedMotion = 'stationary';
}

export function issueMove(
  world: World,
  entity: MechEntity,
  to: Vec2,
  run: boolean,
  options: { engage?: boolean; queued?: boolean } = {},
): boolean {
  if (!isOperational(entity)) return false;

  // Shift held: this leg joins the route instead of replacing it.
  if (options.queued === true && entity.orders.move !== null) {
    entity.orders.queue.push({
      to: { x: to.x, y: to.y },
      run,
      ...(options.engage === true ? { engage: true } : {}),
    });
    return true;
  }

  const path = findPath(world.terrain, entity.pos, to, world.rules.simulation.pathfindMaxNodes);
  if (path === null) return false;

  // A move order is the pilot being told to go somewhere, which overrides an
  // order to stand still. Keep-facing survives — moving is the point of it.
  if (isRooted(entity)) entity.posture = 'free';

  entity.orders.move = {
    to: { x: to.x, y: to.y },
    run,
    ...(options.engage === true ? { engage: true } : {}),
  };
  entity.orders.queue = options.queued === true ? entity.orders.queue : [];
  entity.path = path;
  entity.pathIndex = 0;
  entity.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
  entity.motion = run ? 'run' : 'walk';
  entity.intendedMotion = entity.motion;
  return true;
}

export function issueAttack(
  entity: MechEntity,
  targetId: EntityId,
  calledShot: MechLocation | null,
): void {
  if (!isOperational(entity)) return;
  entity.orders.attack = { targetId, calledShot };
  entity.targetId = targetId;
  entity.calledShot = calledShot;
}

/** Fires the jets toward a point, clamped to the reach the mech actually has. */
export function issueJump(world: World, entity: MechEntity, to: Vec2): boolean {
  return beginJump(world, entity, to);
}

/** Whether the jets are aboard, charged and free to fire right now. */
export function canJump(entity: MechEntity): boolean {
  return (
    entity.jumpRange > 0 &&
    entity.jump === null &&
    entity.jumpCooldown <= 0 &&
    isOperational(entity) &&
    entity.shutdownRemaining <= 0 &&
    !isDown(entity) &&
    !isImmobile(entity)
  );
}

export function issueStop(entity: MechEntity): void {
  entity.orders.move = null;
  entity.path = [];
  entity.pathIndex = 0;
  entity.motion = 'stationary';
  entity.intendedMotion = entity.motion;
}

/** An order from the pilot: sets intent, and takes effect immediately. */
export function setGroupEnabled(entity: MechEntity, group: number, enabled: boolean): void {
  if (group < 1 || group > entity.groupIntent.length) return;
  entity.groupIntent[group - 1] = enabled;
  entity.groupEnabled[group - 1] = enabled;
}

export function setHoldFire(entity: MechEntity, holdFire: boolean): void {
  for (let group = 0; group < entity.groupIntent.length; group += 1) {
    entity.groupIntent[group] = !holdFire;
    entity.groupEnabled[group] = !holdFire;
  }
}

/** Reported from intent: a governor throttle is not the pilot holding fire. */
export function isHoldingFire(entity: MechEntity): boolean {
  return entity.groupIntent.every((enabled) => !enabled);
}

function autoAcquire(world: World, entity: MechEntity): MechEntity | null {
  let best: MechEntity | null = null;
  let bestRange = Number.POSITIVE_INFINITY;

  for (const candidate of world.entities) {
    if (candidate.team === entity.team || !isOperational(candidate)) continue;
    if (!isVisibleTo(world.vision, candidate)) continue;

    const range = distance(entity.pos, candidate.pos);
    if (range < bestRange) {
      best = candidate;
      bestRange = range;
    }
  }

  return best;
}

export function updatePlayerControl(world: World, entity: MechEntity): void {
  if (!isOperational(entity) || entity.shutdownRemaining > 0 || isDown(entity)) {
    entity.motion = 'stationary';
    entity.intendedMotion = entity.motion;
    return;
  }

  // Airborne: the arc is committed. Keep picking targets, leave the feet alone.
  if (entity.jump !== null) {
    const airborne = findEntity(world, entity.orders.attack?.targetId ?? null);
    entity.targetId =
      airborne !== null && isOperational(airborne)
        ? airborne.id
        : isHoldingFire(entity)
          ? null
          : (autoAcquire(world, entity)?.id ?? null);
    return;
  }

  // A mech left to its own devices should not cook itself into a shutdown while
  // the player is looking somewhere else. Overridable, but on by default.
  if (entity.heatSafety) applyHeatGovernor(world, entity, false);

  const order = isRooted(entity) ? null : entity.orders.move;
  if (order === null) {
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
    entity.intendedMotion = entity.motion;
  } else if (
    order.engage === true &&
    !isHoldingFire(entity) &&
    engageWorthTarget(world, entity) !== null
  ) {
    // Attack-move, and something has shown itself: stand and fight. The move
    // order is kept — the advance resumes on its own once the field is clear.
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
    entity.intendedMotion = entity.motion;
  } else if (distance(entity.pos, order.to) <= world.rules.movement.arrivalRadius) {
    const next = entity.orders.queue.shift();
    if (next === undefined) {
      issueStop(entity);
    } else {
      issueMove(world, entity, next.to, next.run, {
        ...(next.engage === true ? { engage: true } : {}),
      });
    }
  } else {
    if (entity.path.length === 0 || world.tick >= entity.nextPathTick) {
      const path = findPath(
        world.terrain,
        entity.pos,
        order.to,
        world.rules.simulation.pathfindMaxNodes,
      );
      entity.pathIndex = 0;
      entity.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;

      if (path === null) {
        // Genuinely unreachable: drop the order rather than shuffle forever.
        entity.path = [];
        entity.orders.move = null;
      } else if (path.length === 0) {
        // Already inside the destination tile but not yet on the spot. A tile is
        // four times the arrival radius across, so this is most short orders —
        // walk the last few metres instead of cancelling.
        entity.path = [{ x: order.to.x, y: order.to.y }];
      } else {
        entity.path = path;
      }
    }
    entity.motion = entity.path.length === 0 ? 'stationary' : order.run ? 'run' : 'walk';
    entity.intendedMotion = entity.motion;
  }

  const ordered = findEntity(world, entity.orders.attack?.targetId ?? null);
  if (ordered !== null && isOperational(ordered)) {
    entity.targetId = ordered.id;
    entity.calledShot = entity.orders.attack?.calledShot ?? null;
    return;
  }

  entity.orders.attack = null;
  entity.calledShot = null;

  if (isHoldingFire(entity)) {
    entity.targetId = null;
    return;
  }

  // Return-fire orders mean stay quiet until someone commits: the mech shoots
  // back at whoever last put fire on it and picks nothing of its own. An
  // explicit attack order still overrides this, above.
  if (entity.posture === 'return_fire') {
    const threat = findEntity(world, entity.threatenedBy);
    const remembered = world.tick <= entity.threatenedUntilTick;
    entity.targetId = remembered && threat !== null && isOperational(threat) ? threat.id : null;
    return;
  }

  entity.targetId = autoAcquire(world, entity)?.id ?? null;
}

/**
 * The contact an attack-moving mech should stop for: something visible and
 * inside the reach of a gun it is actually carrying. Passing sensor ghosts do
 * not halt an advance; a target worth shooting does.
 */
function engageWorthTarget(world: World, entity: MechEntity): MechEntity | null {
  const reach = entity.weapons.reduce((longest, mount) => {
    if (mount.destroyed) return longest;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    return weapon === undefined ? longest : Math.max(longest, weapon.range.long);
  }, 0);
  if (reach === 0) return null;

  const target = autoAcquire(world, entity);
  if (target === null) return null;
  return distance(entity.pos, target.pos) <= reach ? target : null;
}
