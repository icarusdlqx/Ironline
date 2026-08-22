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

export interface RepairQueueEntry {
  mechId: string;
  /** Stable ordering among every outstanding booking. */
  position: number;
  /** Waiting place after the active lifts; inherited work is not put in this line. */
  queuePosition: number | null;
  status: 'active' | 'queued' | 'inherited';
  startsOnDay: number | null;
  readyOnDay: number;
}

/**
 * The persisted completion dates are the queue: old saves already carry them,
 * and need no new repair state or save version to remain playable.
 */
export function repairQueue(catalog: Catalog, state: CampaignState): RepairQueueEntry[] {
  const booked = state.mechs
    .map((mech, rosterIndex) => ({ mech, rosterIndex }))
    .filter(({ mech }) => mech.status === 'repairing' && mech.readyOnDay > state.day)
    .sort((a, b) => a.mech.readyOnDay - b.mech.readyOnDay || a.rosterIndex - b.rosterIndex);
  const capacity = catalog.rules.economy.repair.bayCapacity;
  let waiting = 0;

  return booked.map(({ mech }, index) => {
    const previous = booked[index - capacity]?.mech;
    if (previous === undefined) {
      return {
        mechId: mech.id,
        position: index + 1,
        queuePosition: null,
        status: 'active',
        startsOnDay: state.day,
        readyOnDay: mech.readyOnDay,
      };
    }

    // Saves made before capacity existed may promise two completions before a
    // single lift could have performed them. Keep that paid promise, but do
    // not invent an impossible zero-day sequential job in the readout.
    if (mech.readyOnDay <= previous.readyOnDay) {
      return {
        mechId: mech.id,
        position: index + 1,
        queuePosition: null,
        status: 'inherited',
        startsOnDay: null,
        readyOnDay: mech.readyOnDay,
      };
    }

    waiting += 1;
    return {
      mechId: mech.id,
      position: index + 1,
      queuePosition: waiting,
      status: 'queued',
      startsOnDay: previous.readyOnDay,
      readyOnDay: mech.readyOnDay,
    };
  });
}

export function projectedRepairWindow(
  catalog: Catalog,
  state: CampaignState,
  days: number,
): Omit<RepairQueueEntry, 'mechId'> {
  const queue = repairQueue(catalog, state);
  const capacity = catalog.rules.economy.repair.bayCapacity;
  const startsOnDay = Math.max(
    state.day,
    queue[queue.length - capacity]?.readyOnDay ?? state.day,
  );
  const queuePosition =
    startsOnDay === state.day
      ? null
      : queue.filter((entry) => entry.status === 'queued').length + 1;
  return {
    position: queue.length + 1,
    queuePosition,
    status: queuePosition === null ? 'active' : 'queued',
    startsOnDay,
    readyOnDay: startsOnDay + days,
  };
}

/** Books paid work into the authored field-workshop capacity without save-only state. */
export function bookRepair(
  catalog: Catalog,
  state: CampaignState,
  mech: MechRecord,
  days: number,
): RepairQueueEntry {
  const window = projectedRepairWindow(catalog, state, days);
  mech.status = 'repairing';
  mech.readyOnDay = window.readyOnDay;
  mech.rebuildCost = 0;
  return { mechId: mech.id, ...window };
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
  const baseCost =
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
  const baseDays = needsWork ? Math.max(rules.minimumDays, Math.ceil(rawDays)) : 0;
  const factors =
    chassis === undefined
      ? rules.factionFactors.linewrought
      : rules.factionFactors[chassis.faction];
  const cost = Math.round(baseCost * factors.cost);
  const days = baseDays === 0 ? 0 : Math.ceil(baseDays * factors.days);

  return {
    armourPoints,
    internalPoints,
    destroyedLocations,
    cost,
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
    return { ok: false, reason: `repair costs ${estimate.cost} credits`, estimate };
  }

  state.cbills -= estimate.cost;
  bookRepair(catalog, state, mech, estimate.days);

  return { ok: true, reason: null, estimate };
}

export function completeRepair(catalog: Catalog, mech: MechRecord): void {
  mech.condition = pristineCondition(catalog, mech.design);
  mech.status = 'ready';
  mech.rebuildCost = 0;
}
