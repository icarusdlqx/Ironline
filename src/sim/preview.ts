import { heightFactor, hitChance } from './combat';
import { coverFactorAt, lineOfSight } from './los';
import { angleDifference, bearing, distance } from './math';
import {
  findAmmoBin,
  isDown,
  isOperational,
  isStaggered,
  type MechEntity,
  type World,
} from './types';

/**
 * The to-hit readout: what the player is told before committing to a shot.
 *
 * Everything here is derived from the same functions the resolver fires with —
 * `hitChance` above all — and nothing draws from the battle's rng, so opening
 * the readout a hundred times cannot move a single shot. The point of the
 * exercise is legibility: the simulation already prices range bands, motion,
 * forest cover, height and arcs, and a player who cannot see those prices is
 * not making the decisions the systems were built to reward.
 */

export type WeaponBlock = 'destroyed' | 'ammo' | 'range' | 'sight' | 'arc';
export type RangeBand = 'short' | 'medium' | 'long' | 'beyond';

export interface WeaponHitPreview {
  /** The mount's own index, the same key the HUD's weapon rows carry. */
  index: number;
  weaponId: string;
  group: number;
  /** Probability per projectile, or null when the weapon cannot fire at all. */
  chance: number | null;
  blocked: WeaponBlock | null;
  band: RangeBand | null;
}

/** One situational multiplier worth explaining, already filtered to ≠ 1. */
export interface HitFactor {
  id: string;
  label: string;
  value: number;
}

export interface HitPreview {
  targetId: number;
  range: number;
  weapons: WeaponHitPreview[];
  factors: HitFactor[];
}

function bandFor(world: World, weaponId: string, range: number): RangeBand | null {
  const weapon = world.catalog.weapons.get(weaponId);
  if (weapon === undefined) return null;
  if (range <= weapon.range.short) return 'short';
  if (range <= weapon.range.medium) return 'medium';
  if (range <= weapon.range.long) return 'long';
  return 'beyond';
}

/**
 * Whether the shooter can bring its guns onto the target from where it stands.
 *
 * The live firing gate reads the torso as it is pointed this instant, but a
 * preview against a mech the shooter is not engaging yet would then report
 * "off arc" for every hull that happens to be looking elsewhere, which reads
 * as noise rather than advice. What the player is asking is "could it shoot
 * from here", so the gate allows the full wind-up: firing arc plus twist.
 */
function canBear(world: World, shooter: MechEntity, target: MechEntity): boolean {
  const halfArc = (world.rules.combat.firingArcDegrees / 2) * (Math.PI / 180);
  const offset = angleDifference(shooter.facing, bearing(shooter.pos, target.pos));
  return Math.abs(offset) <= halfArc + shooter.twistLimit;
}

/**
 * The weapon-independent multipliers, named so the readout can say *why* the
 * number is what it is. Only entries that are actually biting are returned:
 * a list that always shows eleven ×1.00 rows explains nothing.
 */
function situationalFactors(world: World, shooter: MechEntity, target: MechEntity): HitFactor[] {
  const rules = world.rules.combat;
  const factors: HitFactor[] = [];
  const add = (id: string, label: string, value: number): void => {
    if (Math.abs(value - 1) > 0.005) factors.push({ id, label, value });
  };

  const motionPenalty = rules.shooterMotion[shooter.motion];
  add(
    'shooter_motion',
    shooter.motion === 'jump' ? 'firing mid-jump' : `firing on the ${shooter.motion}`,
    shooter.motion === 'stationary'
      ? motionPenalty
      : Math.min(1, motionPenalty * shooter.movingAccuracyFactor),
  );
  add('target_motion', `target ${target.motion === 'stationary' ? 'standing' : `on the ${target.motion}`}`, rules.targetMotion[target.motion]);
  add('cover', 'target in cover', coverFactorAt(world.terrain, target.pos));
  add('height', 'height advantage', heightFactor(world, shooter, target));
  add('evasive', 'evasive target', target.incomingAccuracyFactor);
  add('targeting', 'fire control', shooter.outgoingAccuracyFactor);
  if (isDown(target)) add('prone', 'target down', world.rules.stability.proneAccuracyFactor);
  if (isStaggered(shooter, world.rules.stability.staggerThreshold)) {
    add('staggered', 'staggered', world.rules.stability.staggeredAccuracyFactor);
  }
  if (world.tick <= target.designatedUntilTick) add('tag', 'target painted', rules.tagFactor);
  if (shooter.calledShot !== null) {
    add('called', 'called shot', rules.calledShot.accuracyFactor);
  }

  return factors;
}

/**
 * What the shooter's guns would do against this target, from here, right now.
 *
 * Gating mirrors the volley loop in `updateWeapons` with two deliberate
 * differences: cooldowns and group toggles are ignored, because a gun that is
 * cycling will fire on the next trigger and the readout is about the position,
 * not the instant; and the arc gate allows the torso wind-up (see `canBear`).
 */
export function hitPreview(world: World, shooter: MechEntity, target: MechEntity): HitPreview | null {
  if (!isOperational(target) || shooter.id === target.id) return null;
  if (shooter.weapons.length === 0) return null;

  const range = distance(shooter.pos, target.pos);
  const sighted = lineOfSight(world.terrain, shooter.pos, target.pos).clear;
  const bears = canBear(world, shooter, target);

  const weapons: WeaponHitPreview[] = shooter.weapons.map((mount) => {
    const base = {
      index: mount.index,
      weaponId: mount.weaponId,
      group: mount.group,
      band: bandFor(world, mount.weaponId, range),
    };
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (mount.destroyed || weapon === undefined) {
      return { ...base, chance: null, blocked: 'destroyed' as const };
    }
    if (weapon.ammoPerTon !== null && findAmmoBin(shooter, weapon.id) === null) {
      return { ...base, chance: null, blocked: 'ammo' as const };
    }
    if (range > weapon.range.long * world.rules.combat.maxRangeMultiplier) {
      return { ...base, chance: null, blocked: 'range' as const };
    }
    if (!sighted) return { ...base, chance: null, blocked: 'sight' as const };
    if (!bears) return { ...base, chance: null, blocked: 'arc' as const };

    return {
      ...base,
      chance: hitChance(world, shooter, target, weapon, range),
      blocked: null,
    };
  });

  return {
    targetId: target.id,
    range,
    weapons,
    factors: situationalFactors(world, shooter, target),
  };
}
