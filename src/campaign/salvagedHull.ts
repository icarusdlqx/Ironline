import type { Catalog } from '../schema/load';
import type { Design } from '../schema/design';
import type { MechRecord, RecoveredHull } from './types';

function strippedDesign(catalog: Catalog, design: Design): Design {
  const internalHeatSinks = catalog.chassis.get(design.chassisId)?.internalHeatSinks;
  return {
    ...structuredClone(design),
    heatSinks: internalHeatSinks ?? design.heatSinks,
    mounts: [],
    ammo: [],
    equipment: [],
  };
}

/** A recovered chassis carries its field damage; loose parts stay in the crate claim. */
export function recoveredHulk(
  catalog: Catalog,
  hull: RecoveredHull,
  id: string,
  day: number,
): MechRecord | null {
  const design = catalog.designs.get(hull.designId);
  if (design === undefined) return null;
  return {
    id,
    design: strippedDesign(catalog, design),
    condition: structuredClone(hull.condition),
    status: 'hulk',
    readyOnDay: day,
    rebuildCost: Math.round(
      (catalog.chassis.get(design.chassisId)?.baseCost ?? 0) *
        catalog.rules.salvage.hulkRebuildCostFraction,
    ),
  };
}
