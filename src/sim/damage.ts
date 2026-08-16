import { abilityFactor } from './abilities';
import type { MechLocation } from '../schema/common';
import type { ArmourFace } from './arcs';
import { emit } from './events';
import { addStabilityImpulse } from './stability';
import type { AmmoBin, KillMethod, MechEntity, World } from './types';

export function destroyMech(world: World, entity: MechEntity, method: KillMethod): void {
  if (entity.destroyed) return;
  entity.destroyed = true;
  entity.killMethod = method;
  entity.motion = 'stationary';
  entity.intendedMotion = entity.motion;
  entity.path = [];
  entity.pathIndex = 0;
  emit(world.events, { type: 'mech_destroyed', tick: world.tick, entityId: entity.id, method });
}

export function detonateAmmoBin(world: World, entity: MechEntity, bin: AmmoBin): void {
  const rounds = bin.rounds;
  bin.destroyed = true;
  bin.rounds = 0;
  if (rounds <= 0) return;

  const weapon = world.catalog.weapons.get(bin.weaponId);
  const perRound = (weapon?.damage ?? 0) * (weapon?.projectiles ?? 1);
  const damage = Math.min(
    world.rules.damage.ammoExplosionCap,
    rounds * perRound * world.rules.damage.ammoExplosionDamagePerRound,
  );

  emit(world.events, {
    type: 'ammo_explosion',
    tick: world.tick,
    entityId: entity.id,
    location: bin.location,
    damage,
  });

  const core = entity.locations.centre_torso;
  if (core.destroyed) return;

  core.internal -= damage;
  entity.stats.damageTaken += damage;
  if (core.internal <= 0) destroyLocation(world, entity, 'centre_torso', 'ammo_explosion');
}

/** A breached power store venting into the centre torso, the way an ammo bin does. */
function detonateVolatile(world: World, entity: MechEntity, damage: number): void {
  emit(world.events, {
    type: 'ammo_explosion',
    tick: world.tick,
    entityId: entity.id,
    location: 'centre_torso',
    damage,
  });

  const core = entity.locations.centre_torso;
  if (core.destroyed) return;

  core.internal -= damage;
  entity.stats.damageTaken += damage;
  if (core.internal <= 0) destroyLocation(world, entity, 'centre_torso', 'ammo_explosion');
}

export function destroyLocation(
  world: World,
  entity: MechEntity,
  location: MechLocation,
  via: KillMethod | null = null,
): void {
  const state = entity.locations[location];
  if (state.destroyed) return;

  state.destroyed = true;
  state.armour = 0;
  state.rearArmour = 0;
  state.internal = 0;
  emit(world.events, {
    type: 'location_destroyed',
    tick: world.tick,
    entityId: entity.id,
    location,
  });

  for (const mount of entity.weapons) {
    if (mount.location !== location || mount.destroyed) continue;
    mount.destroyed = true;

    // A Gauss rifle's capacitors dump into the mech when the mount is breached.
    // That risk is what the fifteen tons and the low heat are paying for.
    const weapon = world.catalog.weapons.get(mount.weaponId);
    if (weapon === undefined || !weapon.tags.includes('volatile')) continue;
    detonateVolatile(world, entity, weapon.damage * world.rules.damage.volatileExplosionFactor);
  }

  for (const bin of entity.ammoBins) {
    if (bin.location !== location || bin.destroyed) continue;
    if (bin.protectedByCase) {
      bin.destroyed = true;
      bin.rounds = 0;
      continue;
    }
    detonateAmmoBin(world, entity, bin);
  }

  // A mech that loses a leg lurches. The design doc has always said losing one
  // carries a chance of going over; this is that chance, and it goes through
  // the same pool everything else does, so a good pilot can ride it out.
  if (location === 'left_leg' || location === 'right_leg') {
    addStabilityImpulse(world, entity, world.rules.stability.legLossImpulse);
  }

  if (location === 'head') {
    if (world.rng.chance(world.rules.damage.headDestroyedEjectionChance)) {
      entity.pilot.ejected = true;
      emit(world.events, { type: 'pilot_ejected', tick: world.tick, entityId: entity.id });
    } else {
      entity.pilot.dead = true;
    }
    destroyMech(world, entity, 'head');
    return;
  }

  if (location === 'centre_torso') destroyMech(world, entity, via ?? 'centre_torso');
}

/**
 * The face travels with the shot, not with the location — so a round that comes
 * in from behind, blows an arm off and spills inboard eats the side torso's back
 * plate too, which is what it would have hit had the arm not been in the way.
 */
export function applyDamage(
  world: World,
  target: MechEntity,
  location: MechLocation,
  amount: number,
  face: ArmourFace = 'front',
): number {
  let remaining = amount * target.damageTakenFactor * abilityFactor(world, target, 'damageTaken');
  let absorbed = 0;
  let current: MechLocation | null = location;
  const visited = new Set<MechLocation>();

  while (current !== null && remaining > 0) {
    if (visited.has(current)) break;
    visited.add(current);

    const state = target.locations[current];
    if (state.destroyed) {
      current = world.rules.damage.transfer[current];
      continue;
    }

    // A leg has no back, so rear fire on one meets the only plate it has.
    const plate = face === 'rear' && state.rearArmourMax > 0 ? 'rearArmour' : 'armour';
    if (state[plate] > 0) {
      const applied = Math.min(state[plate], remaining);
      state[plate] -= applied;
      remaining -= applied;
      absorbed += applied;
    }

    if (remaining <= 0) break;

    const applied = Math.min(state.internal, remaining);
    state.internal -= applied;
    remaining -= applied;
    absorbed += applied;

    if (state.internal > 0) break;

    const next = world.rules.damage.transfer[current];
    destroyLocation(world, target, current);
    current = next;
  }

  return absorbed;
}
