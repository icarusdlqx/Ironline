import { LOCATIONS, type MechLocation } from '../schema/common';
import { canJump, isHoldingFire } from '../sim/orders';
import { isIdentifiedBy } from '../sim/sensors';
import { findEntity, isOperational, isStaggered, type MechEntity, type World } from '../sim/types';
import type { LocationSnapshot, UnitSnapshot, WeaponSnapshot } from './store';
import {
  abilityReadout,
  alphaReadout,
  reactorReadout,
  stabilityReadout,
} from './combatTelemetry';

function locationsOf(entity: MechEntity): Record<MechLocation, LocationSnapshot> {
  const entries = LOCATIONS.map((location) => {
    const state = entity.locations[location];
    return [
      location,
      {
        armour: state.armour,
        armourMax: state.armourMax,
        rearArmour: state.rearArmour,
        rearArmourMax: state.rearArmourMax,
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
      location: mount.location,
    };
  });
}

/** Metres to the closest machine on a given team, or null if that side is gone. */
function rangeToTeam(world: World, entity: MechEntity, team: number): number | null {
  let best: number | null = null;
  for (const other of world.entities) {
    if (other.team !== team || !isOperational(other)) continue;
    const range = Math.hypot(other.pos.x - entity.pos.x, other.pos.y - entity.pos.y);
    if (best === null || range < best) best = range;
  }
  return best;
}

export function snapshotUnit(world: World, entity: MechEntity): UnitSnapshot {
  const target = findEntity(world, entity.targetId);
  const playerTeam = world.playerTeam ?? 0;
  return {
    id: entity.id,
    team: entity.team,
    name: entity.name,
    pilotName: entity.pilot.name,
    pilotSkills: {
      gunnery: entity.pilot.gunnery,
      piloting: entity.pilot.piloting,
      sensors: entity.pilot.sensors,
    },
    pilotTraits: [...entity.pilot.traits],
    tonnage: entity.tonnage,
    alive: isOperational(entity),
    destroyed: entity.destroyed,
    killMethod: entity.killMethod,
    heat: entity.heat,
    heatCapacity: entity.heatCapacity,
    shutdownRemaining: entity.shutdownRemaining,
    downRemaining: entity.downRemaining,
    staggered: isStaggered(entity, world.rules.stability.staggerThreshold),
    motion: entity.motion,
    targetName: target === null ? null : target.name,
    targetRange:
      target === null
        ? null
        : Math.hypot(target.pos.x - entity.pos.x, target.pos.y - entity.pos.y),
    rangeToLance: entity.team === playerTeam ? null : rangeToTeam(world, entity, playerTeam),
    lostLocations: LOCATIONS.filter((location) => entity.locations[location].destroyed),
    locations: locationsOf(entity),
    weapons: weaponsOf(world, entity),
    groupEnabled: [...entity.groupEnabled],
    holdingFire: isHoldingFire(entity),
    heatSafety: entity.heatSafety,
    ability: abilityReadout(world, entity),
    alpha: alphaReadout(world, entity),
    stability: stabilityReadout(world, entity),
    reactor: reactorReadout(world, entity),
    hasMoveOrder: entity.orders.move !== null,
    jumpRange: entity.jumpRange,
    jumpCooldown: entity.jumpCooldown,
    canJump: canJump(entity),
    posture: entity.posture,
    identified: isIdentifiedBy(world.vision, entity),
    sensorRange: entity.sensorRange,
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
