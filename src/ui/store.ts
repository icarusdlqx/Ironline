import { create } from 'zustand';
import type { MechLocation } from '../schema/common';
import type { EntityId } from '../sim/types';

export type OrderMode = 'move' | 'run' | 'attack' | 'called_shot' | null;

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
  hasMoveOrder: boolean;
}

export interface GameState {
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
  orderMode: OrderMode;
  calledShotLocation: MechLocation | null;
  units: UnitSnapshot[];
  enemies: UnitSnapshot[];
  log: string[];
}

export interface GameActions {
  setSelection: (ids: EntityId[]) => void;
  setOrderMode: (mode: OrderMode) => void;
  setCalledShotLocation: (location: MechLocation | null) => void;
  patch: (partial: Partial<GameState>) => void;
  pushLog: (line: string) => void;
}

const LOG_LIMIT = 60;

export const useGame = create<GameState & GameActions>((set) => ({
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
  orderMode: null,
  calledShotLocation: null,
  units: [],
  enemies: [],
  log: [],

  setSelection: (ids) => set({ selection: ids }),
  setOrderMode: (mode) => set({ orderMode: mode }),
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
