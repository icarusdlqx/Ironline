import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { Design } from '../schema/design';
import { splitArmour } from '../sim/loadout';
import type { CampaignState, LocationCondition, MechRecord } from './types';

export interface RepairEstimate {
  armourPoints: number;
  internalPoints: number;
  destroyedLocations: MechLocation[];
  cost: number;
  days: number;
}

export function pristineCondition(
  catalog: Catalog,
  design: Design,
): Record<MechLocation, LocationCondition> {
  const chassis = catalog.chassis.get(design.chassisId);
  const entries = LOCATIONS.map((location) => {
    // Through the same helper the sim spawns with, so a mech straight out of
    // the workshop matches one that never left it.
    const plate = splitArmour(catalog.rules.construction, location, design.armour[location]);
    return [
      location,
      {
        armour: plate.front,
        rearArmour: plate.rear,
        internal: chassis?.internals[location] ?? 0,
        destroyed: false,
      } satisfies LocationCondition,
    ];
  });
  return Object.fromEntries(entries) as Record<MechLocation, LocationCondition>;
}

export function wreckedCondition(
  catalog: Catalog,
  design: Design,
): Record<MechLocation, LocationCondition> {
  const condition = pristineCondition(catalog, design);
  for (const location of LOCATIONS) {
    condition[location] = { armour: 0, rearArmour: 0, internal: 1, destroyed: false };
  }
  return condition;
}

export function estimateRepair(
  catalog: Catalog,
  mech: MechRecord,
): RepairEstimate {
  const rules = catalog.rules.economy.repair;
  const chassis = catalog.chassis.get(mech.design.chassisId);

  let armourPoints = 0;
  let internalPoints = 0;
  const destroyedLocations: MechLocation[] = [];

  for (const location of LOCATIONS) {
    const state = mech.condition[location];
    if (state.destroyed) {
      destroyedLocations.push(location);
      armourPoints += mech.design.armour[location];
      internalPoints += chassis?.internals[location] ?? 0;
      continue;
    }
    // The design's number is still the target: front and rear together are
    // exactly what it paid for, so the workshop bills for whichever is missing.
    armourPoints += Math.max(0, mech.design.armour[location] - state.armour - state.rearArmour);
    internalPoints += Math.max(0, (chassis?.internals[location] ?? 0) - state.internal);
  }

  const chassisCost = chassis?.baseCost ?? 0;
  const cost =
    armourPoints * rules.armourCostPerPoint +
    internalPoints * rules.internalCostPerPoint +
    destroyedLocations.length * chassisCost * rules.locationReplaceCostFraction +
    mech.rebuildCost;

  const rawDays =
    armourPoints / rules.armourPointsPerDay +
    internalPoints / rules.internalPointsPerDay +
    destroyedLocations.length * rules.locationReplaceDays +
    (mech.rebuildCost > 0 ? catalog.rules.salvage.hulkRebuildDays : 0);

  const needsWork = armourPoints > 0 || internalPoints > 0 || mech.rebuildCost > 0;
  const days = needsWork ? Math.max(rules.minimumDays, Math.ceil(rawDays)) : 0;

  return {
    armourPoints,
    internalPoints,
    destroyedLocations,
    cost: Math.round(cost),
    days,
  };
}

export interface RepairResult {
  ok: boolean;
  reason: string | null;
  estimate: RepairEstimate;
}

export function startRepair(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
): RepairResult {
  const estimate = estimateRepair(catalog, mech);

  if (estimate.days === 0) {
    return { ok: false, reason: 'this mech is already battle ready', estimate };
  }
  if (mech.status === 'repairing') {
    return { ok: false, reason: 'this mech is already in the bay', estimate };
  }
  if (estimate.cost > state.cbills) {
    return { ok: false, reason: `repair costs ${estimate.cost} C-bills`, estimate };
  }

  state.cbills -= estimate.cost;
  mech.status = 'repairing';
  mech.readyOnDay = state.day + estimate.days;
  mech.rebuildCost = 0;

  return { ok: true, reason: null, estimate };
}

export function completeRepair(catalog: Catalog, mech: MechRecord): void {
  mech.condition = pristineCondition(catalog, mech.design);
  mech.status = 'ready';
  mech.rebuildCost = 0;
}
