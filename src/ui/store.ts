import { create } from 'zustand';
import type { MechLocation } from '../schema/common';
import type { SupportCallId } from '../sim/support';
import type { EntityId } from '../sim/types';

export type OrderMode = 'move' | 'run' | 'attack' | 'called_shot' | 'jump' | null;

export interface ObjectiveView {
  id: string;
  label: string;
  required: boolean;
  status: string;
  progress: number;
}

export interface ZoneView {
  id: string;
  name: string;
  owner: number | null;
  contender: number | null;
  progress: number;
  captureSeconds: number;
  contested: boolean;
}

export interface WeaponSnapshot {
  index: number;
  name: string;
  group: number;
  cooldown: number;
  cooldownMax: number;
  destroyed: boolean;
  rounds: number | null;
  shortRange: number;
  longRange: number;
}

export interface LocationSnapshot {
  armour: number;
  armourMax: number;
  internal: number;
  internalMax: number;
  destroyed: boolean;
}

export interface UnitSnapshot {
  id: EntityId;
  team: number;
  name: string;
  pilotName: string;
  tonnage: number;
  alive: boolean;
  destroyed: boolean;
  killMethod: string | null;
  heat: number;
  heatCapacity: number;
  shutdownRemaining: number;
  motion: string;
  targetName: string | null;
  locations: Record<MechLocation, LocationSnapshot>;
  weapons: WeaponSnapshot[];
  groupEnabled: boolean[];
  holdingFire: boolean;
  heatSafety: boolean;
  hasMoveOrder: boolean;
  /** How far the jets can throw this mech; 0 when it has none. */
  jumpRange: number;
  /** Seconds until the jets recharge, 0 when they are ready. */
  jumpCooldown: number;
  canJump: boolean;
  /** The standing order this mech is following between orders. */
  posture: string;
}

export type Screen = 'battle' | 'mechbay' | 'campaign';

export interface GameState {
  screen: Screen;
  campaignPending: boolean;
  ready: boolean;
  error: string | null;
  paused: boolean;
  tick: number;
  elapsedSeconds: number;
  finished: boolean;
  winner: number | null;
  playerTeam: number;
  heatTiers: number[];
  selection: EntityId[];
  /** Lance elements the player has bound to the number keys. */
  controlGroups: Record<number, EntityId[]>;
  orderMode: OrderMode;
  calledShotLocation: MechLocation | null;
  units: UnitSnapshot[];
  enemies: UnitSnapshot[];
  log: string[];

  skirmishMissionId: string;
  missionName: string;
  briefing: string;
  briefingSeen: boolean;
  resourcePoints: number;
  objectives: ObjectiveView[];
  zones: ZoneView[];
  missionStatus: 'active' | 'success' | 'failure';
  missionReason: string | null;
  supportMode: SupportCallId | null;
  reservesLeft: number;
}

export interface GameActions {
  setSelection: (ids: EntityId[]) => void;
  assignControlGroup: (slot: number, ids: EntityId[]) => void;
  setOrderMode: (mode: OrderMode) => void;
  setSupportMode: (call: SupportCallId | null) => void;
  setCalledShotLocation: (location: MechLocation | null) => void;
  patch: (partial: Partial<GameState>) => void;
  pushLog: (line: string) => void;
}

const LOG_LIMIT = 60;

export const useGame = create<GameState & GameActions>((set) => ({
  screen: 'battle',
  campaignPending: false,
  ready: false,
  error: null,
  paused: false,
  tick: 0,
  elapsedSeconds: 0,
  finished: false,
  winner: null,
  playerTeam: 0,
  heatTiers: [],
  selection: [],
  controlGroups: {},
  orderMode: null,
  calledShotLocation: null,
  units: [],
  enemies: [],
  log: [],

  skirmishMissionId: 'skirmish_ridge',
  missionName: '',
  briefing: '',
  briefingSeen: false,
  resourcePoints: 0,
  objectives: [],
  zones: [],
  missionStatus: 'active',
  missionReason: null,
  supportMode: null,
  reservesLeft: 0,

  setSelection: (ids) => set({ selection: ids }),
  assignControlGroup: (slot, ids) =>
    set((state) => ({ controlGroups: { ...state.controlGroups, [slot]: ids } })),
  setOrderMode: (mode) => set({ orderMode: mode, supportMode: null }),
  setSupportMode: (call) => set({ supportMode: call, orderMode: null }),
  setCalledShotLocation: (location) => set({ calledShotLocation: location }),
  patch: (partial) => set(partial),
  pushLog: (line) =>
    set((state) => ({ log: [line, ...state.log].slice(0, LOG_LIMIT) })),
}));

export function selectedUnit(state: GameState): UnitSnapshot | null {
  const id = state.selection[0];
  if (id === undefined) return null;
  return (
    state.units.find((unit) => unit.id === id) ??
    state.enemies.find((unit) => unit.id === id) ??
    null
  );
}
