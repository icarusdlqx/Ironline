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
  /** Who they are, carried over from the register so the barracks can say. */
  bio: string;
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

/** What one pilot did on one drop, and what it did for them. */
export interface PilotReport {
  pilotId: string;
  name: string;
  mech: string;
  kills: number;
  damage: number;
  xp: number;
  /** Skills raised on the strength of this drop, as "gunnery 3". */
  promotions: string[];
  fate: 'returned' | 'injured' | 'killed';
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
  /**
   * The debrief. Progression that only ever appeared as a line in a scrolling
   * log may as well not be in the game: this is what the player is told they
   * earned by taking a contract.
   */
  pilotReports: PilotReport[];
}

export interface CampaignState {
  campaignId: string;
  seed: string;
  rng: RngState;
  day: number;
  cbills: number;
  mechs: MechRecord[];
  pilots: PilotRecord[];
  /**
   * Pilots the commander has held back from the next drop. A mission fields
   * fewer machines than a company owns, and which of them go is a decision,
   * not whatever order the roster happens to be in.
   */
  benched: string[];
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
