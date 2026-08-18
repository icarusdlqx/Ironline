import type { Catalog } from '../schema/load';
import type { LanceEntry } from '../sim/world';
import { asPilot, assign } from './roster';
import {
  findMech,
  isMechAvailable,
  isPilotAvailable,
  type CampaignState,
  type MechRecord,
  type PilotRecord,
} from './types';

export const PLAYER_TEAM = 0;

/** Thrown when the company cannot field anything, so the UI can say so rather than crash. */
export class DeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentError';
  }
}

export interface DeployablePair {
  mech: MechRecord;
  pilot: PilotRecord;
}

function isFieldable(state: CampaignState, mech: MechRecord): boolean {
  return mech.status !== 'hulk' && isMechAvailable(state, mech);
}

/**
 * Everyone who can walk out of the bay, paired with what they will walk out in.
 * Pilots keep their own mech; anybody left over is seated in a spare hull.
 *
 * That second pass matters: salvaged chassis arrive with nobody assigned, and a
 * killed pilot's mech is unbound, so a company could hold fit pilots and
 * battle-ready mechs and still field nothing. This function only reads;
 * `fillEmptySeats` writes the pairing back so the barracks agrees with it.
 */
export function deployableLance(state: CampaignState): DeployablePair[] {
  const pairs: DeployablePair[] = [];
  const spoken = new Set<string>();
  const held = (id: string): boolean => state.benched.includes(id);

  for (const pilot of state.pilots) {
    if (pilot.mechId === null) continue;
    spoken.add(pilot.mechId);
    if (!isPilotAvailable(state, pilot) || held(pilot.id)) continue;
    const mech = findMech(state, pilot.mechId);
    if (mech === null || !isFieldable(state, mech)) continue;
    pairs.push({ mech, pilot });
  }

  for (const pilot of state.pilots) {
    if (pilot.mechId !== null || !isPilotAvailable(state, pilot) || held(pilot.id)) continue;
    const free = state.mechs.find(
      (mech) => !spoken.has(mech.id) && isFieldable(state, mech),
    );
    if (free === undefined) break;
    spoken.add(free.id);
    pairs.push({ mech: free, pilot });
  }

  return pairs;
}

/** Records the pairing `deployableLance` worked out, so the roster matches the field. */
export function fillEmptySeats(state: CampaignState): void {
  for (const pair of deployableLance(state)) {
    if (pair.pilot.mechId !== pair.mech.id) assign(state, pair.pilot.id, pair.mech.id);
  }
}

/** A wide sanity cap; authored tonnage remains the real constraint on a drop. */
export const DROP_BERTHS = 6;

export function missionSlots(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  const authored =
    mission?.lances.find((lance) => lance.team === PLAYER_TEAM)?.units.length ?? 0;
  return authored === 0 ? 0 : Math.max(authored, DROP_BERTHS);
}

function tonnageOf(catalog: Catalog, design: { chassisId: string }): number {
  return catalog.chassis.get(design.chassisId)?.tonnage ?? 0;
}

/** Missing allowances inherit the weight of the authored player lance. */
export function dropTonnageFor(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  if (mission === undefined) return 0;
  if (mission.dropTonnage !== null) return mission.dropTonnage;

  const lance = mission.lances.find((entry) => entry.team === PLAYER_TEAM);
  return (lance?.units ?? []).reduce((total, unit) => {
    const design = catalog.designs.get(unit.designId);
    return total + (design === undefined ? 0 : tonnageOf(catalog, design));
  }, 0);
}

/** Berths are checked before weight so every caller fields the same lance. */
export function dropTeam(
  catalog: Catalog,
  state: CampaignState,
  missionId: string,
): DeployablePair[] {
  const berths = missionSlots(catalog, missionId);
  const allowance = dropTonnageFor(catalog, missionId);
  const taken: DeployablePair[] = [];
  let tons = 0;

  for (const pair of deployableLance(state)) {
    if (taken.length >= berths) break;
    const weight = tonnageOf(catalog, pair.mech.design);
    if (tons + weight > allowance) continue;
    taken.push(pair);
    tons += weight;
  }
  return taken;
}

export interface Deployment {
  seed: string;
  missionId: string;
  playerTeam: number;
  lance: DeployablePair[];
  entries: LanceEntry[];
}

/** Builds the battle inputs for the active contract, shared by the harness and the UI. */
export function prepareDeployment(catalog: Catalog, state: CampaignState): Deployment {
  const contract = state.contract;
  if (contract === null) throw new Error('no active contract');

  fillEmptySeats(state);
  const lance = dropTeam(catalog, state, contract.missionId);
  if (lance.length === 0) {
    const anyReady = deployableLance(state).length > 0;
    throw new DeploymentError(
      anyReady
        ? `Nothing the company can field fits the ${dropTonnageFor(catalog, contract.missionId)}t drop allowance for this contract.`
        : 'No mech is ready to deploy. Repair a mech, rebuild a hulk, or wait for a pilot to recover.',
    );
  }

  return {
    seed: `${state.seed}:${contract.nodeId}:${state.day}`,
    missionId: contract.missionId,
    playerTeam: PLAYER_TEAM,
    lance,
    entries: lance.map(({ mech, pilot }) => ({
      design: mech.design,
      pilot: asPilot(pilot),
      damage: mech.condition,
    })),
  };
}
