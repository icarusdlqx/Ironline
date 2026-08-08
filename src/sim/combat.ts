import type { MechLocation } from '../schema/common';
import type { CombatRules } from '../schema/rules';
import type { Weapon } from '../schema/weapon';
import { applyDamage } from './damage';
import { emit } from './events';
import { addHeat, currentHeatTier } from './heat';
import { coverFactorAt, lineOfSight } from './los';
import { angleDifference, bearing, clamp, distance as distanceBetween } from './math';
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
): number {
  const rules = world.rules.combat;
  const gunnery = rules.gunneryBase[shooter.pilot.gunnery - 1] ?? rules.gunneryBase[0] ?? 0.5;

  let chance = gunnery;
  chance *= rangeFactor(rules, weapon, range);
  if (range < weapon.range.min) chance *= rules.minimumRangeFactor;
  chance *= rules.shooterMotion[shooter.motion];
  chance *= rules.targetMotion[target.motion];
  chance *= coverFactorAt(world.terrain, target.pos);
  chance *= target.incomingAccuracyFactor;
  chance *= shooter.outgoingAccuracyFactor;
  chance *= weapon.accuracy;
  chance *= currentHeatTier(world, shooter).accuracyFactor;
  if (shooter.calledShot !== null) chance *= rules.calledShot.accuracyFactor;

  return clamp(chance, rules.hitChanceFloor, rules.hitChanceCeiling);
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
    const hit = world.rng.chance(hitChance(world, shooter, target, weapon, range));
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
  if (Math.abs(angleDifference(shooter.facing, bearing(shooter.pos, target.pos))) > halfArc) return;

  if (!lineOfSight(world.terrain, shooter.pos, target.pos).clear) return;

  for (const mount of shooter.weapons) {
    if (mount.destroyed || mount.cooldown > 0) continue;

    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined) continue;
    if (range > weapon.range.long * world.rules.combat.maxRangeMultiplier) continue;
    if (shooter.heat + weapon.heat >= shooter.heatCapacity) continue;

    let bin: AmmoBin | null = null;
    if (weapon.ammoPerTon !== null) {
      bin = findAmmoBin(shooter, weapon.id);
      if (bin === null) continue;
    }

    fireWeapon(world, shooter, target, mount, weapon, range, bin);
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
