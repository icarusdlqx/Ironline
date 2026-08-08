import type { MechLocation } from '../schema/common';
import { distance } from './math';
import { findPath } from './pathfind';
import { isVisibleTo } from './sensors';
import {
  findEntity,
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

export function issueStop(entity: MechEntity): void {
  entity.orders.move = null;
  entity.path = [];
  entity.pathIndex = 0;
  entity.motion = 'stationary';
}

export function setGroupEnabled(entity: MechEntity, group: number, enabled: boolean): void {
  if (group < 1 || group > entity.groupEnabled.length) return;
  entity.groupEnabled[group - 1] = enabled;
}

export function setHoldFire(entity: MechEntity, holdFire: boolean): void {
  for (let group = 0; group < entity.groupEnabled.length; group += 1) {
    entity.groupEnabled[group] = !holdFire;
  }
}

export function isHoldingFire(entity: MechEntity): boolean {
  return entity.groupEnabled.every((enabled) => !enabled);
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
    return;
  }

  const order = entity.orders.move;
  if (order === null) {
    entity.path = [];
    entity.pathIndex = 0;
    entity.motion = 'stationary';
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
      entity.path = path ?? [];
      entity.pathIndex = 0;
      entity.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
      if (path === null || path.length === 0) entity.orders.move = null;
    }
    entity.motion = entity.path.length === 0 ? 'stationary' : order.run ? 'run' : 'walk';
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
