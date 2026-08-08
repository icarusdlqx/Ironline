import { hitChance } from '../combat';
import { coverFactorAt, lineOfSight } from '../los';
import { distance } from '../math';
import { isVisibleTo } from '../sensors';
import { findAmmoBin, isOperational, type MechEntity, type World } from '../types';

export interface TargetScore {
  target: MechEntity;
  score: number;
  range: number;
  expectedDps: number;
}

export function structureFraction(entity: MechEntity): number {
  let current = 0;
  let maximum = 0;
  for (const state of Object.values(entity.locations)) {
    current += state.internal;
    maximum += state.internalMax;
  }
  return maximum === 0 ? 0 : current / maximum;
}

/**
 * How much centre torso is left. On a light mech the whole hull can still read
 * healthy while the one location that actually kills it is nearly open, so this
 * is the number that decides whether a mech is finished.
 */
export function coreFraction(entity: MechEntity): number {
  const core = entity.locations.centre_torso;
  return core.internalMax === 0 ? 0 : core.internal / core.internalMax;
}

export function healthFraction(entity: MechEntity): number {
  let current = 0;
  let maximum = 0;
  for (const state of Object.values(entity.locations)) {
    current += state.armour + state.internal;
    maximum += state.armourMax + state.internalMax;
  }
  return maximum === 0 ? 0 : current / maximum;
}

/** Damage per second this mech can expect to land on that one at the given range. */
export function expectedDps(
  world: World,
  shooter: MechEntity,
  target: MechEntity,
  range: number,
): number {
  let total = 0;

  for (const mount of shooter.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    if (range > weapon.range.long * world.rules.combat.maxRangeMultiplier) continue;
    if (weapon.ammoPerTon !== null && findAmmoBin(shooter, weapon.id) === null) continue;

    const chance = hitChance(world, shooter, target, weapon, range);
    total += (weapon.damage * weapon.projectiles * chance) / weapon.cooldown;
  }

  return total;
}

/** True while at least one mount can still put damage downrange. */
export function canStillFight(world: World, mech: MechEntity): boolean {
  for (const mount of mech.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    if (weapon.ammoPerTon !== null && findAmmoBin(mech, weapon.id) === null) continue;
    return true;
  }
  return false;
}

/** Damage traded in your favour at this range: above 1 you are winning the exchange. */
export function exchangeRatio(
  world: World,
  mech: MechEntity,
  target: MechEntity,
  range: number,
): number {
  const mine = expectedDps(world, mech, target, range);
  const theirs = expectedDps(world, target, mech, range);
  return theirs <= 0 ? mine + 1 : mine / theirs;
}

/** The range at which this mech's own guns are worth the most against that target. */
export function preferredRange(world: World, shooter: MechEntity, target: MechEntity): number {
  const step = world.rules.ai.positioning.rangeSampleStep;

  let longest = 0;
  for (const mount of shooter.weapons) {
    if (mount.destroyed) continue;
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    longest = Math.max(longest, weapon.range.long * world.rules.combat.maxRangeMultiplier);
  }
  if (longest === 0) return 0;

  let best = step;
  let bestDps = -1;

  for (let range = step; range <= longest; range += step) {
    const dps = expectedDps(world, shooter, target, range);
    // Ties go to the longer range: standing off is free damage avoidance.
    if (dps >= bestDps) {
      bestDps = dps;
      best = range;
    }
  }

  return best;
}

function threatOf(world: World, target: MechEntity, shooter: MechEntity, range: number): number {
  const incoming = expectedDps(world, target, shooter, range);
  const outgoing = expectedDps(world, shooter, target, range);
  return outgoing <= 0 ? 1 : 1 + (incoming / outgoing) * world.rules.ai.target.threatWeight;
}

export interface ScoreOptions {
  focusTargetId: number | null;
  currentTargetId: number | null;
}

/**
 * §8's scoring: value what you can hurt, weight it by how badly it is already
 * hurt and how dangerous it is, and discount it by range and cover.
 */
export function scoreTargets(
  world: World,
  shooter: MechEntity,
  options: ScoreOptions,
): TargetScore[] {
  const rules = world.rules.ai.target;
  const scores: TargetScore[] = [];

  for (const target of world.entities) {
    if (target.team === shooter.team || !isOperational(target)) continue;
    if (!isVisibleTo(world.vision, target) && world.vision?.team === shooter.team) continue;

    const range = distance(shooter.pos, target.pos);
    const dps = expectedDps(world, shooter, target, range);
    if (dps <= 0) continue;

    const vulnerability = 1 + (1 - healthFraction(target)) * rules.vulnerabilityWeight;
    const threat = threatOf(world, target, shooter, range);

    const preferred = Math.max(1, preferredRange(world, shooter, target));
    const distancePenalty = Math.max(1, range / preferred) ** rules.distancePenaltyPower;

    const cover = coverFactorAt(world.terrain, target.pos);
    const exposurePenalty = 1 + (1 - cover) * rules.exposurePenaltyWeight;

    let score = (dps * vulnerability * threat) / (distancePenalty * exposurePenalty);

    if (options.focusTargetId === target.id) score *= rules.focusFireBonus;
    if (options.currentTargetId === target.id) score *= rules.switchHysteresis;
    if (!lineOfSight(world.terrain, shooter.pos, target.pos).clear) score *= 0.35;

    scores.push({ target, score, range, expectedDps: dps });
  }

  return scores.sort((a, b) => (b.score === a.score ? a.target.id - b.target.id : b.score - a.score));
}

export function bestTarget(
  world: World,
  shooter: MechEntity,
  options: ScoreOptions,
): TargetScore | null {
  return scoreTargets(world, shooter, options)[0] ?? null;
}
