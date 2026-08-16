import { abilityFactor } from './abilities';
import { emit } from './events';
import { addHeat, currentHeatTier } from './heat';
import { angleDifference, bearing, distance, normaliseAngle } from './math';
import {
  findEntity,
  isDown,
  isImmobile,
  isOperational,
  isStaggered,
  legPenaltyFactor,
  type MechEntity,
  type Vec2,
  type World,
} from './types';

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * How steeply the ground rises in the direction a mech is walking, in levels.
 * Negative going downhill, which costs nothing — a mech picks its way down a
 * scarp at its own pace, it does not tumble faster.
 */
function climbAhead(world: World, entity: MechEntity, heading: number): number {
  const reach = world.terrain.tileSize;
  const ahead = {
    x: entity.pos.x + Math.cos(heading) * reach,
    y: entity.pos.y + Math.sin(heading) * reach,
  };
  return world.terrain.elevationAtPoint(ahead) - world.terrain.elevationAtPoint(entity.pos);
}

export function speedFor(world: World, entity: MechEntity, heading = entity.facing): number {
  const base = entity.motion === 'run' ? entity.runSpeed : entity.walkSpeed;
  const terrain = world.terrain.typeAtPoint(entity.pos);
  const heat = currentHeatTier(world, entity).movementFactor;
  const legs = legPenaltyFactor(entity, world.rules.damage.legDestroyedSpeedFactor);
  // A mech fighting to stay upright is not also striding out.
  const footing = isStaggered(entity, world.rules.stability.staggerThreshold)
    ? world.rules.stability.staggeredSpeedFactor
    : 1;

  // Ground that rises under a mech has to be felt, or a ridge is a painted
  // backdrop that costs nothing to walk up and the high ground is free.
  const rise = Math.max(0, climbAhead(world, entity, heading));
  const climb = 1 / (1 + rise * (1 - world.rules.movement.climbSpeedFactor));

  return base * terrain.moveMultiplier * heat * legs * footing * climb * abilityFactor(world, entity, 'speed');
}

function turnToward(world: World, entity: MechEntity, focus: Vec2): number {
  const desired = bearing(entity.pos, focus);
  const difference = angleDifference(entity.facing, desired);
  const step = Math.min(Math.abs(difference), entity.turnRate * world.dt);
  entity.facing = normaliseAngle(entity.facing + step * Math.sign(difference));
  return angleDifference(entity.facing, desired);
}

export function passableAt(world: World, point: Vec2): boolean {
  const tile = world.terrain.toTile(point);
  return world.terrain.passable(tile.column, tile.row);
}

/** Where a mech would come down aiming at `to`, clamped to what its jets can reach. */
export function jumpLanding(world: World, entity: MechEntity, to: Vec2): Vec2 | null {
  if (entity.jumpRange <= 0) return null;

  const dx = to.x - entity.pos.x;
  const dy = to.y - entity.pos.y;
  const reach = Math.hypot(dx, dy);
  if (reach <= 0) return null;

  // Asking for more than the jets have is an order to jump as far that way as
  // they will go, not a refusal — a pilot pointing past the ridge means "clear it".
  const scale = Math.min(1, entity.jumpRange / reach);
  const landing = { x: entity.pos.x + dx * scale, y: entity.pos.y + dy * scale };
  if (!passableAt(world, landing)) return null;
  return landing;
}

/**
 * Fires the jets. Nothing stops the arc once it starts: the mech is off the
 * ground, so terrain, orders and the pathfinder all wait until it lands.
 */
export function beginJump(world: World, entity: MechEntity, to: Vec2): boolean {
  if (!isOperational(entity) || entity.shutdownRemaining > 0 || isImmobile(entity)) return false;
  if (isDown(entity) || entity.jump !== null || entity.jumpCooldown > 0) return false;

  const landing = jumpLanding(world, entity, to);
  if (landing === null) return false;

  entity.jump = {
    from: { x: entity.pos.x, y: entity.pos.y },
    to: landing,
    elapsed: 0,
    duration: Math.max(world.dt, distance(entity.pos, landing) / world.rules.movement.jumpSpeed),
  };
  entity.jumpCooldown = world.rules.movement.jumpCooldownSeconds;
  entity.motion = 'jump';
  entity.intendedMotion = 'jump';
  entity.path = [];
  entity.pathIndex = 0;
  entity.orders.move = null;
  addHeat(entity, entity.jumpHeat);

  emit(world.events, {
    type: 'jump_started',
    tick: world.tick,
    entityId: entity.id,
    x: landing.x,
    y: landing.y,
  });
  return true;
}

/** Flies the arc. Returns true while the mech is still off the ground. */
export function updateJump(world: World, entity: MechEntity): boolean {
  if (entity.jumpCooldown > 0) entity.jumpCooldown = Math.max(0, entity.jumpCooldown - world.dt);

  const jump = entity.jump;
  if (jump === null) return false;

  // A mech that dies mid-air comes down where it is rather than completing a
  // graceful landing it is in no condition to make.
  if (!isOperational(entity)) {
    entity.jump = null;
    entity.motion = 'stationary';
    return false;
  }

  jump.elapsed += world.dt;
  const progress = Math.min(1, jump.elapsed / jump.duration);
  entity.pos = {
    x: jump.from.x + (jump.to.x - jump.from.x) * progress,
    y: jump.from.y + (jump.to.y - jump.from.y) * progress,
  };
  entity.motion = 'jump';

  if (progress < 1) return true;

  entity.pos = { x: jump.to.x, y: jump.to.y };
  entity.jump = null;
  entity.motion = 'stationary';
  entity.intendedMotion = 'stationary';
  emit(world.events, {
    type: 'jump_landed',
    tick: world.tick,
    entityId: entity.id,
    x: jump.to.x,
    y: jump.to.y,
  });
  return false;
}

/** How high off the ground the mech is, 0 on the pads and 1 at the top of the arc. */
export function jumpHeight(entity: MechEntity): number {
  const jump = entity.jump;
  if (jump === null) return 0;
  const progress = Math.min(1, jump.elapsed / jump.duration);
  return Math.sin(progress * Math.PI);
}

function clearPath(entity: MechEntity): void {
  entity.path = [];
  entity.pathIndex = 0;
  // Whatever walk comes next is judged on its own progress, not on how close
  // this abandoned one happened to get to a waypoint it no longer has.
  entity.stalledTicks = 0;
  entity.closestApproach = Number.POSITIVE_INFINITY;
  entity.motion = 'stationary';
  entity.intendedMotion = 'stationary';
}

/** Swings the torso toward the target within its twist limit, independent of the hull. */
export function updateTorso(world: World, entity: MechEntity): void {
  if (!isOperational(entity) || entity.shutdownRemaining > 0 || isDown(entity)) return;

  const target = findEntity(world, entity.targetId);
  const limit = entity.twistLimit;
  const rate = world.rules.movement.torsoTurnRateDegreesPerSecond * DEGREES_TO_RADIANS * world.dt;

  if (target === null) {
    const settle = Math.min(Math.abs(entity.torsoOffset), rate);
    entity.torsoOffset -= settle * Math.sign(entity.torsoOffset);
    return;
  }

  const desired = angleDifference(entity.facing, bearing(entity.pos, target.pos));
  const wanted = Math.max(-limit, Math.min(limit, desired));
  const step = Math.min(Math.abs(wanted - entity.torsoOffset), rate);
  entity.torsoOffset += step * Math.sign(wanted - entity.torsoOffset);
}

export function weaponBearing(entity: MechEntity): number {
  return normaliseAngle(entity.facing + entity.torsoOffset);
}

/**
 * What walking off-axis costs. Full pace straight ahead, tapering to the rules
 * factor going straight backwards — a mech sidesteps, it does not strafe.
 */
function offAxisFactor(world: World, offset: number): number {
  const worst = world.rules.movement.offAxisSpeedFactor;
  const away = (1 - Math.cos(offset)) / 2;
  return 1 - (1 - worst) * away;
}

export function updateMovement(world: World, entity: MechEntity): void {
  // Airborne: the arc owns the mech's position until it comes down.
  if (updateJump(world, entity)) return;

  if (
    !isOperational(entity) ||
    entity.shutdownRemaining > 0 ||
    isImmobile(entity) ||
    isDown(entity)
  ) {
    entity.motion = 'stationary';
    return;
  }

  let waypoint = entity.path[entity.pathIndex] ?? null;

  // Shouldered past the corner: already closer to the next waypoint than to
  // this one. Turning round to touch a point the mech has effectively passed
  // is what the rest of the lance's shoving would otherwise force.
  if (waypoint !== null) {
    const upcoming = entity.path[entity.pathIndex + 1];
    if (upcoming !== undefined && distance(entity.pos, upcoming) < distance(entity.pos, waypoint)) {
      entity.pathIndex += 1;
      entity.closestApproach = Number.POSITIVE_INFINITY;
      entity.stalledTicks = 0;
      entity.stallStrikes = 0;
      waypoint = upcoming;
    }
  }

  const target = findEntity(world, entity.targetId);

  // Under keep-facing orders the hull tracks the target and the legs do the
  // walking, so the mech crabs to its destination rather than turning its
  // back. With nothing to face it is an ordinary march.
  const crabbing = entity.posture === 'keep_facing' && target !== null;
  const focus = crabbing ? target.pos : (waypoint ?? target?.pos ?? null);

  if (focus === null) {
    entity.motion = 'stationary';
    return;
  }

  const misalignment = turnToward(world, entity, focus);

  if (waypoint === null) {
    entity.motion = 'stationary';
    return;
  }

  let heading = entity.facing;
  let pace = 1;

  if (crabbing) {
    heading = bearing(entity.pos, waypoint);
    pace = offAxisFactor(world, angleDifference(entity.facing, heading));
  } else {
    const alignment = world.rules.movement.moveAlignmentDegrees * DEGREES_TO_RADIANS;
    if (Math.abs(misalignment) > alignment) {
      // Pivoting on the spot is not movement. Reporting it as a run handed the
      // mech the running evasion bonus for free and told the HUD it was moving.
      entity.motion = 'stationary';
      return;
    }
  }

  // Aligned and about to move: report the pace the controller actually asked for.
  entity.motion = entity.intendedMotion === 'stationary' ? 'walk' : entity.intendedMotion;

  const step = speedFor(world, entity, heading) * pace * world.dt;
  if (step <= 0) {
    entity.motion = 'stationary';
    return;
  }

  const dx = Math.cos(heading) * step;
  const dy = Math.sin(heading) * step;
  let next: Vec2 = { x: entity.pos.x + dx, y: entity.pos.y + dy };

  if (!passableAt(world, next)) {
    // Clipping the corner of a building is not a reason to abandon the walk.
    // Try each axis on its own first: sliding along whatever is in the way
    // carries a mech round it, where dropping the path left it standing
    // against the obstacle until something else moved it.
    const alongX: Vec2 = { x: entity.pos.x + dx, y: entity.pos.y };
    const alongY: Vec2 = { x: entity.pos.x, y: entity.pos.y + dy };

    if (passableAt(world, alongX)) next = alongX;
    else if (passableAt(world, alongY)) next = alongY;
    else {
      clearPath(entity);
      return;
    }
  }

  entity.pos = next;

  const radius =
    entity.pathIndex === entity.path.length - 1
      ? world.rules.movement.arrivalRadius
      : world.rules.movement.waypointRadius;

  const gap = distance(entity.pos, waypoint);

  // A mech that has stopped closing on its waypoint is wedged — sliding along
  // a wall that never ends, or shouldered off its line by the rest of the
  // lance. Drop the path so whoever gave it re-solves, rather than walking on
  // the spot for the rest of the battle. The strike stays on the record: a
  // re-solve that keeps stalling is how "the destination is taken" reads.
  if (gap < entity.closestApproach - world.rules.movement.progressEpsilon) {
    entity.closestApproach = gap;
    entity.stalledTicks = 0;
  } else {
    entity.stalledTicks += 1;
    if (entity.stalledTicks > world.rules.movement.stallTicks) {
      entity.stallStrikes += 1;
      clearPath(entity);
      return;
    }
  }

  if (gap > radius) return;

  entity.pathIndex += 1;
  entity.closestApproach = Number.POSITIVE_INFINITY;
  entity.stalledTicks = 0;
  entity.stallStrikes = 0;
  if (entity.pathIndex >= entity.path.length) clearPath(entity);
}
