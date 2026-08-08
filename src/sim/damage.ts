import type { MechLocation } from '../schema/common';
import { emit } from './events';
import type { AmmoBin, KillMethod, MechEntity, World } from './types';

export function destroyMech(world: World, entity: MechEntity, method: KillMethod): void {
  if (entity.destroyed) return;
  entity.destroyed = true;
  entity.killMethod = method;
  entity.motion = 'stationary';
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
  state.internal = 0;
  emit(world.events, {
    type: 'location_destroyed',
    tick: world.tick,
    entityId: entity.id,
    location,
  });

  for (const mount of entity.weapons) {
    if (mount.location === location) mount.destroyed = true;
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

export function applyDamage(
  world: World,
  target: MechEntity,
  location: MechLocation,
  amount: number,
): number {
  let remaining = amount;
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

    if (state.armour > 0) {
      const applied = Math.min(state.armour, remaining);
      state.armour -= applied;
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
