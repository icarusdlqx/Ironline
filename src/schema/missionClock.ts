import type { Catalog } from './load';

export function missionTickBudget(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  if (mission === undefined) throw new Error(`unknown mission "${missionId}"`);

  // A fractional duration must not expire before the time the author gave it.
  return Math.ceil(mission.maxDurationSeconds * catalog.rules.simulation.tickRate);
}
