import type { DifficultyTier } from '../../schema/rules';
import { emit } from '../events';
import { distance } from '../math';
import { setGroupEnabled } from '../orders';
import { findPath } from '../pathfind';
import { isVisibleTo } from '../sensors';
import { isOperational, type EntityId, type MechEntity, type World } from '../types';
import { choosePosition, shouldWithdraw, stanceFor, withdrawalPoint } from './positioning';
import {
  canStillFight,
  coreFraction,
  healthFraction,
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

interface GroupLoad {
  group: number;
  heatPerSecond: number;
  damagePerHeat: number;
}

/** What each weapon group costs to run flat out, and what it buys per point of heat. */
function groupLoads(world: World, mech: MechEntity): GroupLoad[] {
  const totals = new Map<number, { heat: number; damage: number }>();

  for (const mount of mech.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    const entry = totals.get(mount.group) ?? { heat: 0, damage: 0 };
    entry.heat += weapon.heat / weapon.cooldown;
    entry.damage += (weapon.damage * weapon.projectiles) / weapon.cooldown;
    totals.set(mount.group, entry);
  }

  return [...totals]
    .map(([group, total]) => ({
      group,
      heatPerSecond: total.heat,
      damagePerHeat: total.heat === 0 ? Number.POSITIVE_INFINITY : total.damage / total.heat,
    }))
    .sort((a, b) => (b.damagePerHeat === a.damagePerHeat
      ? a.group - b.group
      : b.damagePerHeat - a.damagePerHeat));
}

/**
 * Heat discipline is a dial, not a switch. Running hot, a pilot sheds the guns
 * that cost the most heat per point of damage and keeps firing the rest — going
 * fully dark to save four heat is how a duel outlives the mission clock.
 */
function applyHeatDiscipline(world: World, mech: MechEntity, targetNearlyDead: boolean): void {
  const rules = world.rules.ai.heat;
  const fraction = mech.heat / mech.heatCapacity;

  if (targetNearlyDead && fraction < 1) {
    setAllGroups(mech, true);
    mech.ai.coolingDown = false;
    return;
  }

  if (fraction <= rules.resumeFraction) {
    mech.ai.coolingDown = false;
    setAllGroups(mech, true);
    return;
  }

  // Between the two thresholds, leave the current selection alone: flipping guns
  // on and off every half second is worse than either choice.
  if (!mech.ai.coolingDown && fraction < rules.holdFireFraction) return;

  mech.ai.coolingDown = true;

  const budget = mech.dissipationPerSecond * rules.sustainFactor;
  let spent = 0;

  setAllGroups(mech, false);
  for (const load of groupLoads(world, mech)) {
    if (spent + load.heatPerSecond > budget) continue;
    spent += load.heatPerSecond;
    setGroupEnabled(mech, load.group, true);
  }
}

function setAllGroups(mech: MechEntity, enabled: boolean): void {
  for (let group = 1; group <= mech.groupEnabled.length; group += 1) {
    setGroupEnabled(mech, group, enabled);
  }
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

  mech.path = path ?? [];
  mech.pathIndex = 0;
  mech.nextPathTick = world.tick + world.rules.simulation.aiPathIntervalTicks;
  mech.motion = mech.path.length === 0 ? 'stationary' : run ? 'run' : 'walk';
}

function halt(mech: MechEntity): void {
  mech.path = [];
  mech.pathIndex = 0;
  mech.motion = 'stationary';
}

export function decideTactical(
  world: World,
  mech: MechEntity,
  focusTargetId: EntityId | null,
  tier: DifficultyTier,
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

  if (chosen === null) {
    mech.targetId = null;
    mech.calledShot = null;
    if (mech.ai.withdrawing) {
      moveTo(world, mech, withdrawalPoint(world, mech), true);
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
  applyHeatDiscipline(world, mech, nearlyDead);
  chooseCalledShot(world, mech, chosen.target, tier);

  const stance = stanceFor(world, mech, chosen.target, mech.ai.withdrawing);

  if (stance === 'withdraw') {
    moveTo(world, mech, withdrawalPoint(world, mech), true);
    return;
  }

  // Far outside the engagement envelope, fine positioning is noise — march.
  const approachThreshold =
    stanceFor(world, mech, chosen.target, false) === 'close'
      ? world.rules.ai.positioning.repositionStep * 2
      : 0;

  if (stance === 'close' && chosen.range > approachThreshold) {
    moveTo(world, mech, chosen.target.pos, true);
    return;
  }

  const destination = choosePosition(world, mech, chosen.target, stance, tier);
  if (destination === null) {
    halt(mech);
    return;
  }

  // Backing off only reaches the range you want if you outpace the thing chasing
  // you — and stanceFor has already established that you do.
  const run = stance === 'back_off' || (stance === 'close' && tier.aggression >= 1);
  moveTo(world, mech, destination, run);
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
    mech.path = [];
    emit(world.events, { type: 'unit_withdrew', tick: world.tick, entityId: mech.id, team: mech.team });
  }
}

/** The lance decides together, then each mech acts on that decision. */
export function runTeamAi(world: World, team: number, tier: DifficultyTier): void {
  const focus = lanceFocus(world, team, tier);
  for (const mech of world.entities) {
    if (mech.team !== team || mech.controller !== 'tactical') continue;
    decideTactical(world, mech, focus, tier);
  }
}
