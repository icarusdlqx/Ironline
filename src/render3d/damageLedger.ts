import { LOCATIONS, type MechLocation } from '../schema/common';
import type { SimEvent } from '../sim/events';
import type { LocationState, MechEntity, World } from '../sim/types';

type HitEvent = Extract<SimEvent, { type: 'projectile_hit' }>;

interface LedgerLocation {
  armour: number;
  rearArmour: number;
  rearArmourMax: number;
  internal: number;
  destroyed: boolean;
}

type LedgerUnit = Record<MechLocation, LedgerLocation>;

export interface DamageSplit {
  armour: number;
  structure: number;
  known: boolean;
}

export type DamageWearTier = 0 | 1 | 2;

export function damageWearTier(state: LocationState): DamageWearTier {
  if (state.destroyed) return 2;
  const maximum = state.armourMax + state.rearArmourMax + state.internalMax;
  if (maximum <= 0) return 0;
  const remaining = state.armour + state.rearArmour + state.internal;
  const ratio = remaining / maximum;
  if (ratio <= 0.38) return 2;
  if (ratio <= 0.72) return 1;
  return 0;
}

function copyLocations(entity: MechEntity): LedgerUnit {
  const copy = {} as LedgerUnit;
  for (const location of LOCATIONS) {
    const state = entity.locations[location];
    copy[location] = {
      armour: state.armour,
      rearArmour: state.rearArmour,
      rearArmourMax: state.rearArmourMax,
      internal: state.internal,
      destroyed: state.destroyed,
    };
  }
  return copy;
}

/** Keeps the pre-impact plate state that the post-step world no longer carries. */
export class DamageLedger {
  private readonly units = new Map<number, LedgerUnit>();

  constructor(world: World) {
    this.sync(world);
  }

  classify(
    world: World,
    event: HitEvent,
    out: DamageSplit = { armour: 0, structure: 0, known: false },
  ): DamageSplit {
    out.armour = 0;
    out.structure = 0;
    const unit = this.units.get(event.targetId);
    out.known = unit !== undefined;
    if (unit === undefined) return out;

    let remaining = Math.max(0, event.damage);
    let location: MechLocation | null = event.location;
    let visited = 0;
    while (location !== null && remaining > 0) {
      const index = LOCATIONS.indexOf(location);
      const bit = 1 << index;
      if ((visited & bit) !== 0) break;
      visited |= bit;

      const state = unit[location];
      if (state.destroyed) {
        location = world.rules.damage.transfer[location];
        continue;
      }

      const rear = event.arc === 'rear' && state.rearArmourMax > 0;
      const plate = rear ? 'rearArmour' : 'armour';
      const armour = Math.min(state[plate], remaining);
      state[plate] -= armour;
      remaining -= armour;
      out.armour += armour;

      const structure = Math.min(state.internal, remaining);
      state.internal -= structure;
      remaining -= structure;
      out.structure += structure;

      if (state.internal > 0) break;
      state.destroyed = true;
      location = world.rules.damage.transfer[location];
    }
    return out;
  }

  sync(world: World): void {
    for (const entity of world.entities) {
      const known = this.units.get(entity.id);
      if (known === undefined) {
        this.units.set(entity.id, copyLocations(entity));
        continue;
      }
      for (const location of LOCATIONS) {
        const source = entity.locations[location];
        const target = known[location];
        target.armour = source.armour;
        target.rearArmour = source.rearArmour;
        target.rearArmourMax = source.rearArmourMax;
        target.internal = source.internal;
        target.destroyed = source.destroyed;
      }
    }
  }
}
