import type { MechLocation } from '../schema/common';
import type { Design } from '../schema/design';
import type { RngState } from '../sim/rng';

export interface LocationCondition {
  armour: number;
  internal: number;
  destroyed: boolean;
}

export type MechStatus = 'ready' | 'repairing' | 'hulk';

export interface MechRecord {
  id: string;
  design: Design;
  condition: Record<MechLocation, LocationCondition>;
  status: MechStatus;
  readyOnDay: number;
  /** Set for a salvaged wreck that has not been rebuilt yet. */
  rebuildCost: number;
}

export interface PilotRecord {
  id: string;
  templateId: string;
  name: string;
  gunnery: number;
  piloting: number;
  sensors: number;
  xp: number;
  spentXp: number;
  traits: string[];
  injuredUntilDay: number;
  dead: boolean;
  /** Instance id of the mech this pilot is assigned to, if any. */
  mechId: string | null;
}

export interface Contract {
  nodeId: string;
  missionId: string;
  employer: string;
  payout: number;
  salvageShare: number;
  acceptedOnDay: number;
  deadlineDay: number;
}

export type StoreKind = 'weapon' | 'equipment';

export interface StoreItem {
  kind: StoreKind;
  itemId: string;
  count: number;
}

export interface CampaignLogEntry {
  day: number;
  text: string;
}

export interface MissionOutcome {
  nodeId: string;
  missionId: string;
  won: boolean;
  day: number;
  payout: number;
  salvagedChassis: string[];
  salvagedItems: StoreItem[];
  pilotCasualties: string[];
  mechsLost: string[];
}

export interface CampaignState {
  campaignId: string;
  seed: string;
  rng: RngState;
  day: number;
  cbills: number;
  mechs: MechRecord[];
  pilots: PilotRecord[];
  store: StoreItem[];
  completedNodes: string[];
  failedNodes: string[];
  contract: Contract | null;
  history: MissionOutcome[];
  log: CampaignLogEntry[];
  finished: boolean;
  won: boolean;
  nextId: number;
}

export function findMech(state: CampaignState, id: string): MechRecord | null {
  return state.mechs.find((mech) => mech.id === id) ?? null;
}

export function findPilot(state: CampaignState, id: string): PilotRecord | null {
  return state.pilots.find((pilot) => pilot.id === id) ?? null;
}

export function isMechAvailable(state: CampaignState, mech: MechRecord): boolean {
  return mech.status === 'ready' || (mech.status === 'repairing' && mech.readyOnDay <= state.day);
}

export function isPilotAvailable(state: CampaignState, pilot: PilotRecord): boolean {
  return !pilot.dead && pilot.injuredUntilDay <= state.day;
}

export function storeCount(state: CampaignState, kind: StoreKind, itemId: string): number {
  return state.store.find((item) => item.kind === kind && item.itemId === itemId)?.count ?? 0;
}

export function addToStore(state: CampaignState, kind: StoreKind, itemId: string, count = 1): void {
  const existing = state.store.find((item) => item.kind === kind && item.itemId === itemId);
  if (existing === undefined) state.store.push({ kind, itemId, count });
  else existing.count += count;
}

export function takeFromStore(
  state: CampaignState,
  kind: StoreKind,
  itemId: string,
  count = 1,
): boolean {
  const existing = state.store.find((item) => item.kind === kind && item.itemId === itemId);
  if (existing === undefined || existing.count < count) return false;
  existing.count -= count;
  if (existing.count === 0) {
    state.store = state.store.filter((item) => item !== existing);
  }
  return true;
}
