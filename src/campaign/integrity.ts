import { LOCATIONS } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { MechRecord } from './types';

export interface MechIntegrity {
  current: number;
  maximum: number;
  fraction: number;
}

/** Armour and structure still present against the chassis' undamaged maximum. */
export function mechIntegrity(catalog: Catalog, mech: MechRecord): MechIntegrity {
  const chassis = catalog.chassis.get(mech.design.chassisId);
  let current = 0;
  let maximum = 0;

  for (const location of LOCATIONS) {
    const condition = mech.condition[location];
    current += condition.armour + condition.rearArmour + condition.internal;
    maximum += mech.design.armour[location] + (chassis?.internals[location] ?? 0);
  }

  const fraction = maximum === 0 ? 1 : Math.max(0, Math.min(1, current / maximum));
  return { current, maximum, fraction };
}
