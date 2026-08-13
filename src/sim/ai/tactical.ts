import type { DifficultyTier } from '../../schema/rules';
import { emit } from '../events';
import type { ZoneState } from '../zones';
import { applyHeatGovernor } from '../governor';
import { assignZones } from './mission';
import { roleOf } from './roles';
import { distance } from '../math';
import { findPath } from '../pathfind';
import { isVisibleTo } from '../sensors';
import { canJump } from '../orders';
import { beginJump } from '../movement';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../types';
import {
  approachPoint,
  choosePosition,
  shouldWithdraw,
  stanceFor,
  withdrawalPoint,
} from './positioning';
import {
  canStillFight,
  coreFraction,
  healthFraction,
  preferredRange,
  scoreTargets,
  structureFraction,
} from './utility';

const LEG_LOCATIONS = ['left_leg', 'right_leg'] as const;

export function difficultyTier(world: World, tierId: string | null): DifficultyTier {
  const rules = world.rules.difficulty;
  const chosen = rules.tiers[tierId ?? rules.default] ?? rules.tiers[rules.default];
  if (chosen === undefined) throw new Error(`difficulty tier "${rules.default}" is missing`);
  return chosen;
}

/**
 * The lance agrees on one target: the weakest thing enough of them can reach.
 * Concentrating fire is what turns four mechs into a lance rather than four duels.
 */
export function lanceFocus(world: World, team: number, tier: DifficultyTier): EntityId | null {
  if (!tier.focusFire) return null;

  const members = world.entities.filter(
    (entity) => entity.team === team && isOperational(entity),
  );
  if (members.length === 0) return null;

  let best: { id: EntityId; score: number } | null = null;

  for (const candidate of world.entities) {
    if (candidate.team === team || !isOperational(candidate)) continue;
    if (world.vision?.team === team && !isVisibleTo(world.vision, candidate)) continue;

    const reachable = members.filter(
      (member) => scoreTargets(world, member, { focusTargetId: null, currentTargetId: null })
        .some((entry) => entry.target.id === candidate.id),
    ).length;
    if (reachable === 0) continue;

    // Weakest first, weighted by how many guns can actually bear on it.
    const score = reachable * (1.6 - healthFraction(candidate));
    if (best === null || score > best.score || (score === best.score && candidate.id < best.id)) {
      best = { id: candidate.id, score };
    }
  }

  return best?.id ?? null;
}

function chooseCalledShot(world: World, mech: MechEntity, target: MechEntity, tier: DifficultyTier): void {
  if (!tier.calledShots) {
    mech.calledShot = null;
    return;
  }

  const rules = world.rules.ai.calledShot;
  if (structureFraction(target) > rules.targetStructureFraction) {
    mech.calledShot = null;
    return;
  }

  const standing = LEG_LOCATIONS.filter((location) => !target.locations[location].destroyed);
  if (standing.length === 0) {
    mech.calledShot = null;
    return;
  }

  // Taking the legs leaves the chassis on the field to be towed home.
  mech.calledShot = world.rng.chance(rules.chance) ? world.rng.pick(standing) : null;
}

function moveTo(world: World, mech: MechEntity, destination: { x: number; y: number }, run: boolean): void {
  const path = findPath(
    world.terrain,
    mech.pos,
    destination,
    world.rules.simulation.pathfindMaxNodes,
  );

  // An empty path means "already in that tile", not "cannot get there": the
  // last few metres inside a tile still have to be walked.
  mech.path = path === null ? [] : path.length === 0 ? [{ x: destination.x, y: destination.y }] : path;
  mech.pathIndex = 0;
  mech.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
  mech.motion = mech.path.length === 0 ? 'stationary' : run ? 'run' : 'walk';
  mech.intendedMotion = mech.motion;
}

function halt(mech: MechEntity): void {
  mech.path = [];
  mech.pathIndex = 0;
  mech.motion = 'stationary';
  mech.intendedMotion = mech.motion;
  mech.ai.destination = null;
}

/**
 * Walks to a chosen spot and stays committed to it. The AI re-decides ten times
 * a second; without commitment it re-picks a neighbouring tile every time and
 * the mech pirouettes on the spot instead of going anywhere.
 */
function commitTo(world: World, mech: MechEntity, destination: Vec2, run: boolean): void {
  mech.ai.destination = { x: destination.x, y: destination.y };
  mech.ai.commitUntilTick =
    world.tick + Math.round(world.rules.ai.positioning.commitSeconds / world.dt);
  moveTo(world, mech, destination, run);
}

/** True while the mech is still walking to somewhere it already decided on. */
function holdingCommitment(world: World, mech: MechEntity): boolean {
  const destination = mech.ai.destination;
  if (destination === null) return false;
  if (world.tick >= mech.ai.commitUntilTick) return false;
  if (distance(mech.pos, destination) <= world.rules.movement.arrivalRadius * 2) return false;
  // The path can be cleared by an obstruction; if it is, re-plan rather than stall.
  return mech.path.length > 0;
}

export function decideTactical(
  world: World,
  mech: MechEntity,
  focusTargetId: EntityId | null,
  tier: DifficultyTier,
  /** Ground this mech has been told to take and hold, if the mission scores any. */
  zone: ZoneState | null = null,
): void {
  if (!isOperational(mech) || mech.shutdownRemaining > 0) {
    halt(mech);
    return;
  }

  // Whichever is worse: the hull as a whole, or the one location that ends the fight.
  const structure = Math.min(structureFraction(mech), coreFraction(mech));
  // A mech with its guns shot off or its bins dry has nothing left to contribute;
  // it walks home rather than standing in the open running out the clock.
  const disarmed = !canStillFight(world, mech);
  mech.ai.withdrawing = disarmed || shouldWithdraw(world, mech, mech.ai.withdrawing, structure);
  mech.ai.focusTargetId = focusTargetId;

  const ranked = scoreTargets(world, mech, {
    focusTargetId,
    currentTargetId: mech.targetId,
  });
  const chosen = ranked[0] ?? null;

  const zoneCentre = zone === null ? null : { x: zone.x, y: zone.y };
  const onStation = zone !== null && distance(mech.pos, zoneCentre!) <= zone.radius * 0.75;

  if (chosen === null) {
    mech.targetId = null;
    mech.calledShot = null;
    if (mech.ai.withdrawing) {
      moveTo(world, mech, withdrawalPoint(world, mech), true);
      return;
    }
    // Nothing to shoot: take the ground the mission is scored on, if any.
    if (zoneCentre !== null && !onStation) {
      if (!holdingCommitment(world, mech)) commitTo(world, mech, zoneCentre, true);
      return;
    }
    if (onStation) {
      halt(mech);
      return;
    }
    const fallback = world.entities.find(
      (entity) => entity.team !== mech.team && isOperational(entity),
    );
    if (fallback === undefined) halt(mech);
    else moveTo(world, mech, fallback.pos, true);
    return;
  }

  mech.targetId = chosen.target.id;

  const nearlyDead =
    structureFraction(chosen.target) <= world.rules.ai.heat.finisherOverrideFraction;
  applyHeatGovernor(world, mech, nearlyDead);
  chooseCalledShot(world, mech, chosen.target, tier);

  const stance = stanceFor(world, mech, chosen.target, mech.ai.withdrawing);
  const stanceChanged = stance !== mech.ai.stance;
  mech.ai.stance = stance;

  if (stance === 'withdraw') {
    // Jets are the honest way out of a knife fight: one burn opens more
    // ground than ten seconds of walking backwards under fire.
    if (chosen.range < 140 && jumpTowards(world, mech, withdrawalPoint(world, mech), 50)) return;
    if (stanceChanged || !holdingCommitment(world, mech)) {
      commitTo(world, mech, withdrawalPoint(world, mech), true);
    }
    return;
  }

  // Far outside the engagement envelope, fine positioning is noise — march.
  const approachThreshold = world.rules.ai.positioning.repositionStep * 2;

  if (zoneCentre !== null && !onStation) {
    if (!holdingCommitment(world, mech)) commitTo(world, mech, zoneCentre, true);
    return;
  }

  // A long-range machine has no business marching into the teeth of a lance, but
  // it does have to close when the target is genuinely out of its reach.
  const marchesIn =
    roleOf(world, mech).aggression >= 1 ||
    chosen.range > preferredRange(world, mech, chosen.target) * 1.3;

  if (stance === 'close' && chosen.range > approachThreshold && zone === null && marchesIn) {
    // A closer with jets uses them: the walk in is where brawlers die. Only
    // when the target is well past its guns, and never toward point blank —
    // the landing aims for the mech's own preferred band, not the target.
    if (chosen.range > preferredRange(world, mech, chosen.target) * 1.6) {
      const landing = pointAtRange(
        mech.pos,
        chosen.target.pos,
        preferredRange(world, mech, chosen.target),
      );
      if (jumpTowards(world, mech, landing, 60)) return;
    }
    if (stanceChanged || !holdingCommitment(world, mech)) {
      commitTo(world, mech, approachPoint(world, mech, chosen.target, tier), true);
    }
    return;
  }

  // Inside the envelope, keep walking to the spot already chosen rather than
  // re-solving the ring and turning toward a new neighbour every tick.
  if (!stanceChanged && holdingCommitment(world, mech)) return;

  const destination = choosePosition(world, mech, chosen.target, stance, tier, zone);
  if (destination === null) {
    halt(mech);
    return;
  }

  // Backing off only reaches the range you want if you outpace the thing chasing
  // you — and stanceFor has already established that you do.
  const drive = tier.aggression * roleOf(world, mech).aggression;
  const run = stance === 'back_off' || (stance === 'close' && drive >= 1);
  commitTo(world, mech, destination, run);
}

/**
 * Fires the jets toward a point if the mech has them, they are charged, the
 * reactor can afford the burn, and the hop is long enough to mean something.
 *
 * The minimum is a plain distance, not a multiple of walking speed: what the
 * jets buy is instant displacement in a straight line over anything — for an
 * escape that beats turning and running even on a machine that runs fast.
 */
function jumpTowards(world: World, mech: MechEntity, to: Vec2, minimumReach: number): boolean {
  if (!canJump(mech)) return false;
  if (mech.heat + mech.jumpHeat >= mech.heatCapacity * 0.7) return false;
  const reach = Math.min(mech.jumpRange, distance(mech.pos, to));
  if (reach < minimumReach) return false;
  return beginJump(world, mech, to);
}

/** The point on the line toward `target` that sits `range` away from it. */
function pointAtRange(from: Vec2, target: Vec2, range: number): Vec2 {
  const gap = distance(from, target);
  if (gap <= range) return { x: from.x, y: from.y };
  const t = (gap - range) / gap;
  return { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t };
}

/** How far this mech's longest working gun still reaches. */
function longestReach(world: World, mech: MechEntity): number {
  let reach = 0;
  for (const mount of mech.weapons) {
    if (mount.destroyed) continue;
    reach = Math.max(reach, world.catalog.weapons.get(mount.weaponId)?.range.long ?? 0);
  }
  return reach;
}

/**
 * A withdrawing mech leaves the field once nothing can still shoot it, or once it
 * reaches the edge of the map. The edge matters: against a lance carrying missiles
 * that outrange the battlefield, walking off it is the only way out.
 */
export function resolveDisengagement(world: World): void {
  const rules = world.rules.ai.withdrawal;
  const edge = rules.mapEdgeDistance;
  const extent = {
    x: world.terrain.width * world.terrain.tileSize,
    y: world.terrain.height * world.terrain.tileSize,
  };

  for (const mech of world.entities) {
    if (!mech.ai.withdrawing || !isOperational(mech)) continue;

    const offField =
      mech.pos.x <= edge ||
      mech.pos.y <= edge ||
      mech.pos.x >= extent.x - edge ||
      mech.pos.y >= extent.y - edge;

    if (!offField) {
      // Contact is broken when no surviving enemy gun still covers this position.
      const covered = world.entities.some(
        (other) =>
          other.team !== mech.team &&
          isOperational(other) &&
          distance(mech.pos, other.pos) <= longestReach(world, other) * rules.disengageRangeFactor,
      );
      if (covered) continue;
    }

    mech.withdrawn = true;
    mech.motion = 'stationary';
    mech.intendedMotion = mech.motion;
    mech.path = [];
    emit(world.events, { type: 'unit_withdrew', tick: world.tick, entityId: mech.id, team: mech.team });
  }
}

/** The lance decides together, then each mech acts on that decision. */
export function runTeamAi(world: World, team: number, tier: DifficultyTier): void {
  const focus = lanceFocus(world, team, tier);
  const stations = assignZones(world, team);
  for (const mech of world.entities) {
    if (mech.team !== team || mech.controller !== 'tactical') continue;
    // Airborne: the arc is committed, so there is nothing left to decide.
    if (mech.jump !== null) continue;
    decideTactical(world, mech, focus, tier, stations.get(mech.id) ?? null);
  }
}
