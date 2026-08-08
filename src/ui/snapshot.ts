import { LOCATIONS, type MechLocation } from '../schema/common';
import { isHoldingFire } from '../sim/orders';
import { findEntity, isOperational, type MechEntity, type World } from '../sim/types';
import type { LocationSnapshot, UnitSnapshot, WeaponSnapshot } from './store';

function locationsOf(entity: MechEntity): Record<MechLocation, LocationSnapshot> {
  const entries = LOCATIONS.map((location) => {
    const state = entity.locations[location];
    return [
      location,
      {
        armour: state.armour,
        armourMax: state.armourMax,
        internal: state.internal,
        internalMax: state.internalMax,
        destroyed: state.destroyed,
      } satisfies LocationSnapshot,
    ];
  });
  return Object.fromEntries(entries) as Record<MechLocation, LocationSnapshot>;
}

function weaponsOf(world: World, entity: MechEntity): WeaponSnapshot[] {
  return entity.weapons.map((mount) => {
    const weapon = world.catalog.weapons.get(mount.weaponId);
    const bin = entity.ammoBins.find((entry) => entry.weaponId === mount.weaponId && !entry.destroyed);
    return {
      index: mount.index,
      name: weapon?.name ?? mount.weaponId,
      group: mount.group,
      cooldown: mount.cooldown,
      cooldownMax: weapon?.cooldown ?? 1,
      destroyed: mount.destroyed,
      rounds: weapon?.ammoPerTon === null ? null : (bin?.rounds ?? 0),
      shortRange: weapon?.range.short ?? 0,
      longRange: weapon?.range.long ?? 0,
    };
  });
}

export function snapshotUnit(world: World, entity: MechEntity): UnitSnapshot {
  const target = findEntity(world, entity.targetId);
  return {
    id: entity.id,
    team: entity.team,
    name: entity.name,
    pilotName: entity.pilot.name,
    tonnage: entity.tonnage,
    alive: isOperational(entity),
    destroyed: entity.destroyed,
    killMethod: entity.killMethod,
    heat: entity.heat,
    heatCapacity: entity.heatCapacity,
    shutdownRemaining: entity.shutdownRemaining,
    motion: entity.motion,
    targetName: target === null ? null : target.name,
    locations: locationsOf(entity),
    weapons: weaponsOf(world, entity),
    groupEnabled: [...entity.groupEnabled],
    holdingFire: isHoldingFire(entity),
    hasMoveOrder: entity.orders.move !== null,
  };
}

export function snapshotUnits(world: World, playerTeam: number): {
  units: UnitSnapshot[];
  enemies: UnitSnapshot[];
} {
  const units: UnitSnapshot[] = [];
  const enemies: UnitSnapshot[] = [];

  for (const entity of world.entities) {
    if (entity.team === playerTeam) {
      units.push(snapshotUnit(world, entity));
      continue;
    }
    if (world.vision !== null && !world.vision.visible.has(entity.id)) continue;
    enemies.push(snapshotUnit(world, entity));
  }

  return { units, enemies };
}
