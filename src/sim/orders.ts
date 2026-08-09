import type { MechLocation } from '../schema/common';
import { applyHeatGovernor } from './governor';
import { distance } from './math';
import { beginJump } from './movement';
import { findPath } from './pathfind';
import { isVisibleTo } from './sensors';
import {
  findEntity,
  isImmobile,
  isOperational,
  type EntityId,
  type MechEntity,
  type Vec2,
  type World,
} from './types';

export interface MoveOrder {
  to: Vec2;
  run: boolean;
}

export interface AttackOrder {
  targetId: EntityId;
  calledShot: MechLocation | null;
}

export interface OrderState {
  move: MoveOrder | null;
  attack: AttackOrder | null;
}

export function emptyOrders(): OrderState {
  return { move: null, attack: null };
}

export function issueMove(world: World, entity: MechEntity, to: Vec2, run: boolean): boolean {
  if (!isOperational(entity)) return false;

  const path = findPath(world.terrain, entity.pos, to, world.rules.simulation.pathfindMaxNodes);
  if (path === null) return false;

  entity.orders.move = { to: { x: to.x, y: to.y }, run };
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
  if (!isOperational(entity) || entity.shutdownRemaining > 0) {
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

  const order = entity.orders.move;
  if (order === null) {
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
    entity.intendedMotion = entity.motion;
  } else if (distance(entity.pos, order.to) <= world.rules.movement.arrivalRadius) {
    issueStop(entity);
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
  entity.targetId = isHoldingFire(entity) ? null : (autoAcquire(world, entity)?.id ?? null);
}
