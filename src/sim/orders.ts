import type { MechLocation } from '../schema/common';
import { bodyRadius } from './collision';
import { emit } from './events';
import { applyHeatGovernor } from './governor';
import { lineOfSight } from './los';
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
    to: reachableDestination(world, path, to),
    run,
    ...(options.engage === true ? { engage: true } : {}),
  };
  entity.stallStrikes = 0;
  // A plain move order is "disengage and go": it releases the standing
  // attack order, or the mech marches to the spot and then wanders back to
  // chase its old target. The guns still pick opportunistic targets on the
  // way; attack-move keeps the engagement, since fighting through is its
  // entire point.
  if (options.engage !== true) entity.orders.attack = null;
  entity.orders.queue = options.queued === true ? entity.orders.queue : [];
  entity.path = path;
  entity.pathIndex = 0;
  // A new order starts with a clean record of how it is going. Carrying the
  // last one's counters over meant a mech that had been wedged took a stall
  // strike on the very first tick of its fresh order — the closest it had
  // ever been to the OLD waypoint is not a bar the new one can clear — and
  // the route was wiped before the player ever saw the line.
  entity.stalledTicks = 0;
  entity.closestApproach = Number.POSITIVE_INFINITY;
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
  entity.stallStrikes = 0;
  entity.motion = 'stationary';
  entity.intendedMotion = entity.motion;
}

/**
 * Where an order can actually end. When the path stops short of the ask — the
 * click was on water, a cliff, the far side of a wall — the order is retargeted
 * to the ground the route reaches. Left pointed at the unreachable spot, the
 * arrival check can never pass, and the mech spends the rest of the battle
 * walking into the bank, stalling, and re-solving the same route.
 */
function reachableDestination(world: World, path: readonly Vec2[], asked: Vec2): Vec2 {
  const last = path[path.length - 1];
  if (last === undefined || distance(last, asked) <= world.rules.movement.arrivalRadius) {
    return { x: asked.x, y: asked.y };
  }
  return { x: last.x, y: last.y };
}

/** How many stalled re-solves mean the route is hopeless and the order drops. */
const HOPELESS_STRIKES = 3;

/**
 * Whether another machine is parked on the destination, close enough that the
 * walker cannot take the spot, and the walker is already up against it. This
 * is the honest test for "the ground I was sent to is taken".
 */
function standingOnDestination(world: World, entity: MechEntity, to: Vec2): boolean {
  const reach = bodyRadius(world, entity);
  for (const other of world.entities) {
    if (other.id === entity.id || !isOperational(other) || other.jump !== null) continue;
    const clearance = reach + bodyRadius(world, other);
    if (distance(other.pos, to) > clearance) continue;
    // Something is on the spot; the order is done when the walker is up
    // against that machine rather than still crossing the map towards it.
    if (distance(entity.pos, other.pos) <= clearance + world.rules.movement.arrivalRadius) {
      return true;
    }
  }
  return false;
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
    // No march on the books — but an attack order on something out of reach
    // is still an order to go and fight it. A target set and then stood
    // around for reads as a control that does nothing: the panel says
    // "no sight" on every gun and the mech never moves to change that.
    const quarry = isRooted(entity)
      ? null
      : findEntity(world, entity.orders.attack?.targetId ?? null);
    if (
      quarry === null ||
      !isOperational(quarry) ||
      !approachToEngage(world, entity, quarry)
    ) {
      entity.path = [];
      entity.pathIndex = 0;
      entity.motion = 'stationary';
      entity.intendedMotion = entity.motion;
    }
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
  } else if (
    distance(entity.pos, order.to) <= world.rules.movement.arrivalRadius ||
    // Stalled out with the destination itself under another machine: the last
    // stretch is a body, not ground. That is as arrived as this order is ever
    // going to get — looping walk-shove-stall against a lance-mate for the
    // rest of the battle is what "my mech is stuck" means. It has to be the
    // spot that is occupied, not merely somewhere near it: measuring from the
    // walker's own bulk made this discard orders to open ground up to forty
    // metres off, which is an order the player watched vanish.
    (entity.stallStrikes > 0 && standingOnDestination(world, entity, order.to))
  ) {
    const next = entity.orders.queue.shift();
    if (next === undefined) {
      issueStop(entity);
    } else {
      issueMove(world, entity, next.to, next.run, {
        ...(next.engage === true ? { engage: true } : {}),
      });
    }
  } else if (entity.stallStrikes >= HOPELESS_STRIKES) {
    // Re-solved the route this many times and stalled out every time — the
    // way is shut. Standing down beats headbutting the blockage forever, but
    // it is said out loud: an order that evaporates in silence is the hardest
    // thing to tell apart from a control that does not work.
    issueStop(entity);
    if (!entity.autopilot) {
      emit(world.events, {
        type: 'mission_message',
        tick: world.tick,
        text: `${entity.name} cannot find a way through — order dropped.`,
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
        // Genuinely unreachable: drop the order rather than shuffle forever,
        // and say so — a route that quietly ceases to exist mid-walk looks
        // from the outside exactly like the game forgetting the order.
        entity.path = [];
        entity.orders.move = null;
        if (!entity.autopilot) {
          emit(world.events, {
            type: 'mission_message',
            tick: world.tick,
            text: `${entity.name} has no route to that point.`,
          });
        }
      } else if (path.length === 0) {
        // Already inside the destination tile but not yet on the spot. A tile is
        // four times the arrival radius across, so this is most short orders —
        // walk the last few metres instead of cancelling.
        entity.path = [{ x: order.to.x, y: order.to.y }];
      } else {
        entity.path = path;
        // The re-solve can also come up short of the ask; anchor the order to
        // what the route actually reaches, or arrival never fires.
        order.to = reachableDestination(world, path, order.to);
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

/** The longest reach of any working gun aboard, in metres. */
function longestReach(world: World, entity: MechEntity): number {
  return entity.weapons.reduce((longest, mount) => {
    if (mount.destroyed) return longest;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    return weapon === undefined ? longest : Math.max(longest, weapon.range.long);
  }, 0);
}

/**
 * Walks an attack-ordered mech into the fight: toward its quarry until it is
 * inside most of its longest gun's reach with a line of sight, then stops to
 * shoot from there rather than marching on to point blank. Returns true while
 * the approach is still walking; false hands the feet back to whoever called.
 */
function approachToEngage(world: World, entity: MechEntity, quarry: MechEntity): boolean {
  const reach = longestReach(world, entity);
  // Nothing to shoot with: charging a machine you cannot hurt is not an
  // approach, it is a donation.
  if (reach <= 0) return false;

  const gap = distance(entity.pos, quarry.pos);
  const sighted = lineOfSight(world.terrain, entity.pos, quarry.pos).clear;
  if (gap <= reach * 0.85 && sighted) return false;

  if (entity.path.length === 0 || world.tick >= entity.nextPathTick) {
    const path = findPath(
      world.terrain,
      entity.pos,
      quarry.pos,
      world.rules.simulation.pathfindMaxNodes,
    );
    entity.pathIndex = 0;
    entity.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
    entity.path = path ?? [];
  }
  if (entity.path.length === 0) return false;

  entity.motion = 'walk';
  entity.intendedMotion = 'walk';
  return true;
}

/**
 * The contact an attack-moving mech should stop for: something visible and
 * inside the reach of a gun it is actually carrying. Passing sensor ghosts do
 * not halt an advance; a target worth shooting does.
 */
function engageWorthTarget(world: World, entity: MechEntity): MechEntity | null {
  const reach = longestReach(world, entity);
  if (reach === 0) return null;

  const target = autoAcquire(world, entity);
  if (target === null) return null;
  return distance(entity.pos, target.pos) <= reach ? target : null;
}
