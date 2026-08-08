import { currentHeatTier } from './heat';
import { angleDifference, bearing, distance, normaliseAngle } from './math';
import {
  findEntity,
  isImmobile,
  isOperational,
  legPenaltyFactor,
  type MechEntity,
  type Vec2,
  type World,
} from './types';

const DEGREES_TO_RADIANS = Math.PI / 180;

export function speedFor(world: World, entity: MechEntity): number {
  const base = entity.motion === 'run' ? entity.runSpeed : entity.walkSpeed;
  const terrain = world.terrain.typeAtPoint(entity.pos);
  const heat = currentHeatTier(world, entity).movementFactor;
  const legs = legPenaltyFactor(entity, world.rules.damage.legDestroyedSpeedFactor);
  return base * terrain.moveMultiplier * heat * legs;
}

function turnToward(world: World, entity: MechEntity, focus: Vec2): number {
  const desired = bearing(entity.pos, focus);
  const difference = angleDifference(entity.facing, desired);
  const step = Math.min(Math.abs(difference), entity.turnRate * world.dt);
  entity.facing = normaliseAngle(entity.facing + step * Math.sign(difference));
  return angleDifference(entity.facing, desired);
}

function clearPath(entity: MechEntity): void {
  entity.path = [];
  entity.pathIndex = 0;
  entity.motion = 'stationary';
}

export function updateMovement(world: World, entity: MechEntity): void {
  if (!isOperational(entity) || entity.shutdownRemaining > 0 || isImmobile(entity)) {
    entity.motion = 'stationary';
    return;
  }

  const waypoint = entity.path[entity.pathIndex] ?? null;
  const target = findEntity(world, entity.targetId);
  const focus = waypoint ?? target?.pos ?? null;

  if (focus === null) {
    entity.motion = 'stationary';
    return;
  }

  const misalignment = turnToward(world, entity, focus);

  if (waypoint === null) {
    entity.motion = 'stationary';
    return;
  }

  const alignment = world.rules.movement.moveAlignmentDegrees * DEGREES_TO_RADIANS;
  if (Math.abs(misalignment) > alignment) return;

  const step = speedFor(world, entity) * world.dt;
  if (step <= 0) return;

  const next: Vec2 = {
    x: entity.pos.x + Math.cos(entity.facing) * step,
    y: entity.pos.y + Math.sin(entity.facing) * step,
  };

  const tile = world.terrain.toTile(next);
  if (!world.terrain.passable(tile.column, tile.row)) {
    clearPath(entity);
    return;
  }

  entity.pos = next;

  const radius =
    entity.pathIndex === entity.path.length - 1
      ? world.rules.movement.arrivalRadius
      : world.rules.movement.waypointRadius;

  if (distance(entity.pos, waypoint) > radius) return;

  entity.pathIndex += 1;
  if (entity.pathIndex >= entity.path.length) clearPath(entity);
}
