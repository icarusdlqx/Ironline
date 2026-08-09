import type { MechLocation } from '../schema/common';
import type { CombatRules } from '../schema/rules';
import type { Weapon } from '../schema/weapon';
import { applyDamage } from './damage';
import { emit } from './events';
import { addHeat, currentHeatTier } from './heat';
import { coverFactorAt, lineOfSight } from './los';
import { angleDifference, bearing, clamp, distance as distanceBetween } from './math';
import { weaponBearing } from './movement';
import {
  findAmmoBin,
  findEntity,
  isOperational,
  type AmmoBin,
  type MechEntity,
  type Projectile,
  type WeaponMount,
  type World,
} from './types';

function rangeFactor(rules: CombatRules, weapon: Weapon, range: number): number {
  if (range <= weapon.range.short) return rules.rangeFactor.short;
  if (range <= weapon.range.medium) return rules.rangeFactor.medium;
  if (range <= weapon.range.long) return rules.rangeFactor.long;
  return rules.rangeFactor.beyond;
}

export function hitChance(
  world: World,
  shooter: MechEntity,
  target: MechEntity,
  weapon: Weapon,
  range: number,
  /** Heat penalty as it stood when the volley began; see updateWeapons. */
  heatAccuracy?: number,
): number {
  const rules = world.rules.combat;
  const gunnery = rules.gunneryBase[shooter.pilot.gunnery - 1] ?? rules.gunneryBase[0] ?? 0.5;

  let chance = gunnery;
  chance *= rangeFactor(rules, weapon, range);
  if (range < weapon.range.min) chance *= rules.minimumRangeFactor;
  const motionPenalty = rules.shooterMotion[shooter.motion];
  chance *= shooter.motion === 'stationary'
    ? motionPenalty
    : Math.min(1, motionPenalty * shooter.movingAccuracyFactor);
  chance *= rules.targetMotion[target.motion];
  chance *= coverFactorAt(world.terrain, target.pos);
  chance *= target.incomingAccuracyFactor;
  chance *= shooter.outgoingAccuracyFactor;
  chance *= lanceGunnery(world, shooter);
  if (weapon.type === 'missile') chance *= target.amsMissileFactor;
  if (world.tick <= target.designatedUntilTick) chance *= rules.tagFactor;
  chance *= weapon.accuracy;
  chance *= heatAccuracy ?? currentHeatTier(world, shooter).accuracyFactor;
  if (shooter.calledShot !== null) chance *= rules.calledShot.accuracyFactor;

  return clamp(chance, rules.hitChanceFloor, rules.hitChanceCeiling);
}

/** A command console on the field lifts everyone on that side, not just its own guns. */
function lanceGunnery(world: World, shooter: MechEntity): number {
  let factor = 1;
  for (const mate of world.entities) {
    if (mate.team !== shooter.team || !isOperational(mate)) continue;
    if (mate.lanceAccuracyFactor !== 1) factor *= mate.lanceAccuracyFactor;
  }
  return factor;
}

function rollHitLocation(world: World, shooter: MechEntity): MechLocation {
  const called = shooter.calledShot;
  if (called !== null && world.rng.chance(world.rules.combat.calledShot.locationChance)) {
    return called;
  }
  return world.rng.weighted(world.hitLocationTable);
}

function recordShot(world: World, weapon: Weapon, hit: boolean): void {
  const stat = world.weaponStats.get(weapon.id) ?? { shots: 0, hits: 0, damage: 0, heat: 0 };
  stat.shots += 1;
  if (hit) stat.hits += 1;
  world.weaponStats.set(weapon.id, stat);
}

function fireWeapon(
  world: World,
  shooter: MechEntity,
  target: MechEntity,
  mount: WeaponMount,
  weapon: Weapon,
  range: number,
  bin: AmmoBin | null,
  heatAccuracy: number,
): void {
  addHeat(shooter, weapon.heat);
  mount.cooldown = weapon.cooldown;

  if (bin !== null) {
    bin.rounds -= 1;
    shooter.stats.ammoSpent += 1;
  }

  const stat = world.weaponStats.get(weapon.id) ?? { shots: 0, hits: 0, damage: 0, heat: 0 };
  stat.heat += weapon.heat;
  world.weaponStats.set(weapon.id, stat);

  emit(world.events, {
    type: 'weapon_fired',
    tick: world.tick,
    shooterId: shooter.id,
    targetId: target.id,
    weaponId: weapon.id,
  });

  const travelTicks =
    weapon.velocity === null ? 0 : Math.ceil(range / weapon.velocity / world.dt);

  for (let shot = 0; shot < weapon.projectiles; shot += 1) {
    const hit = world.rng.chance(hitChance(world, shooter, target, weapon, range, heatAccuracy));
    shooter.stats.shotsFired += 1;
    if (hit) shooter.stats.shotsHit += 1;
    recordShot(world, weapon, hit);

    world.projectiles.push({
      shooterId: shooter.id,
      targetId: target.id,
      weaponId: weapon.id,
      hit,
      location: hit ? rollHitLocation(world, shooter) : 'centre_torso',
      damage: weapon.damage,
      impactTick: world.tick + travelTicks,
    });
  }
}

export function updateWeapons(world: World, shooter: MechEntity): void {
  for (const mount of shooter.weapons) {
    if (mount.cooldown > 0) mount.cooldown = Math.max(0, mount.cooldown - world.dt);
  }

  if (!isOperational(shooter) || shooter.shutdownRemaining > 0) return;

  const target = findEntity(world, shooter.targetId);
  if (target === null || !isOperational(target)) return;

  const range = distanceBetween(shooter.pos, target.pos);
  const halfArc = (world.rules.combat.firingArcDegrees / 2) * (Math.PI / 180);
  const aim = angleDifference(weaponBearing(shooter), bearing(shooter.pos, target.pos));
  if (Math.abs(aim) > halfArc) return;

  if (!lineOfSight(world.terrain, shooter.pos, target.pos).clear) return;

  // The whole volley leaves at once, so every weapon rolls against the heat the
  // mech was carrying when the trigger came in. Applying each weapon's own heat
  // before its own roll made a gun less accurate purely for being listed later.
  //
  // Mount order still decides which weapon is dropped when the volley would
  // breach heat capacity. That is left alone deliberately: designs list their
  // primary weapons first, and every reordering tried here cost the tactical AI
  // far more than the baseline, because its governor keeps it in the heat band
  // where the capacity gate actually bites.
  const heatAccuracy = currentHeatTier(world, shooter).accuracyFactor;

  for (const mount of shooter.weapons) {
    if (mount.destroyed || mount.cooldown > 0) continue;
    if (shooter.groupEnabled[mount.group - 1] !== true) continue;

    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    if (range > weapon.range.long * world.rules.combat.maxRangeMultiplier) continue;
    if (shooter.heat + weapon.heat >= shooter.heatCapacity) continue;

    let bin: AmmoBin | null = null;
    if (weapon.ammoPerTon !== null) {
      bin = findAmmoBin(shooter, weapon.id);
      if (bin === null) continue;
    }

    fireWeapon(world, shooter, target, mount, weapon, range, bin, heatAccuracy);
  }
}

export function resolveProjectiles(world: World): void {
  if (world.projectiles.length === 0) return;

  const pending: Projectile[] = [];

  for (const projectile of world.projectiles) {
    if (projectile.impactTick > world.tick) {
      pending.push(projectile);
      continue;
    }

    const target = findEntity(world, projectile.targetId);
    const shooter = findEntity(world, projectile.shooterId);
    if (target === null || !isOperational(target)) continue;

    if (!projectile.hit) {
      emit(world.events, {
        type: 'projectile_miss',
        tick: world.tick,
        shooterId: projectile.shooterId,
        targetId: projectile.targetId,
        weaponId: projectile.weaponId,
      });
      continue;
    }

    const absorbed = applyDamage(world, target, projectile.location, projectile.damage);
    target.stats.damageTaken += absorbed;

    // A flamer barely scratches the armour; what it does is cook the reactor.
    const fired = world.catalog.weapons.get(projectile.weaponId);
    if (fired !== undefined && fired.targetHeat > 0) addHeat(target, fired.targetHeat);

    const stat = world.weaponStats.get(projectile.weaponId);
    if (stat !== undefined) stat.damage += absorbed;

    if (shooter !== null) {
      shooter.stats.damageDealt += absorbed;
      if (!isOperational(target)) shooter.stats.kills += 1;
    }

    emit(world.events, {
      type: 'projectile_hit',
      tick: world.tick,
      shooterId: projectile.shooterId,
      targetId: projectile.targetId,
      weaponId: projectile.weaponId,
      location: projectile.location,
      damage: absorbed,
    });
  }

  world.projectiles = pending;
}
