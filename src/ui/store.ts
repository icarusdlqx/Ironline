import { create } from 'zustand';
import type { MechLocation } from '../schema/common';
import type { SupportCallId } from '../sim/support';
import type { EntityId } from '../sim/types';
import type { FormationPreset } from './formationPreset';
import { initialBattleCode } from './battleCode';
import { initialSkirmishMission } from './trainingProgress';

export type OrderMode = 'move' | 'run' | 'attack' | 'attack_move' | 'called_shot' | 'jump' | null;

export interface ObjectiveView {
  id: string;
  label: string;
  required: boolean;
  status: string;
  progress: number;
  sustained?: boolean;
  stopped?: { stopped: number; total: number };
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
  /** Where the weapon is bolted, so a lost arm explains a silent gun. */
  location: MechLocation;
}

export interface TimedActionSnapshot {
  label: string;
  note: string;
  ready: boolean;
  activeRemaining: number;
  cooldownRemaining: number;
}

export interface StabilitySnapshot {
  value: number;
  staggerAt: number;
  knockdownAt: number;
  footingRemaining: number;
}

export type HeatBandTone = 'ok' | 'warn' | 'danger' | 'critical';

export interface ReactorSnapshot {
  /** Heat carried if every live gun bears throughout the next available alpha window. */
  alphaHeat: number;
  projectedFraction: number;
  projectedBand: string;
  projectedTone: HeatBandTone;
  governorHoldAt: number;
  governorResumeAt: number;
  /** Groups the pilot asked for but the governor has taken out of the firing plan. */
  shedGroups: number[];
}

export interface LocationSnapshot {
  armour: number;
  armourMax: number;
  rearArmour: number;
  rearArmourMax: number;
  internal: number;
  internalMax: number;
  destroyed: boolean;
}

export interface UnitSnapshot {
  id: EntityId;
  team: number;
  name: string;
  pilotName: string;
  /** What the pilot brings, so their skills are visible where the mech is. */
  pilotSkills: { gunnery: number; piloting: number; sensors: number };
  pilotTraits: string[];
  tonnage: number;
  alive: boolean;
  destroyed: boolean;
  killMethod: string | null;
  heat: number;
  heatCapacity: number;
  shutdownRemaining: number;
  /** Seconds left on the ground; zero means upright. */
  downRemaining: number;
  /** Rocking but still standing — the next heavy hit is the one that floors it. */
  staggered: boolean;
  motion: string;
  targetName: string | null;
  /** Metres to whatever this mech is shooting at, so ranges mean something. */
  targetRange: number | null;
  /** How far away this mech is from the player's nearest machine. */
  rangeToLance: number | null;
  /** Which structural locations have been shot off. */
  lostLocations: MechLocation[];
  locations: Record<MechLocation, LocationSnapshot>;
  weapons: WeaponSnapshot[];
  groupEnabled: boolean[];
  holdingFire: boolean;
  heatSafety: boolean;
  ability: TimedActionSnapshot;
  alpha: TimedActionSnapshot;
  stability: StabilitySnapshot;
  reactor: ReactorSnapshot;
  hasMoveOrder: boolean;
  /** How far the jets can throw this mech; 0 when it has none. */
  jumpRange: number;
  /** Seconds until the jets recharge, 0 when they are ready. */
  jumpCooldown: number;
  canJump: boolean;
  /** The standing order this mech is following between orders. */
  posture: string;
  /**
   * False for a hostile the lance holds on sensors but cannot name yet. A
   * return on a scope is not the same as knowing what is walking at you.
   */
  identified: boolean;
  /** How far this machine's own sensors reach, for the range overlay. */
  sensorRange: number;
}

export type Screen = 'home' | 'battle' | 'mechbay' | 'campaign';

export interface BattleEntry {
  missionId?: string;
  battleCode?: string;
  campaignPending?: boolean;
}

/**
 * The to-hit readout for the primary selected mech, refreshed with the HUD.
 * `hover` says whether it is priced against the hull under the cursor or the
 * mech's standing target, so the panel can say which question it is answering.
 */
export interface HitPreviewView {
  shooterId: EntityId;
  targetId: EntityId;
  targetName: string;
  range: number;
  hover: boolean;
  /** Chance per weapon, keyed by the mount index the weapon rows carry. */
  weapons: { index: number; chance: number | null; blocked: string | null }[];
  factors: { id: string; label: string; value: number }[];
}

/**
 * The AI strength the player picked, kept across sessions. First launches
 * start on green: a stranger's opening battle decides whether there is a
 * second one, and the picker is right there for anyone who wants more.
 */
export function readDifficulty(): string {
  try {
    return localStorage.getItem('ironline.difficulty') ?? 'green';
  } catch {
    return 'green';
  }
}

export function storeDifficulty(tier: string): void {
  try {
    localStorage.setItem('ironline.difficulty', tier);
  } catch {
    // Private browsing: the choice lasts for the session only.
  }
}

export interface GameState {
  screen: Screen;
  campaignPending: boolean;
  ready: boolean;
  error: string | null;
  paused: boolean;
  /** Simulation rate as a multiple of real time. Pause is a separate flag. */
  speed: number;
  tick: number;
  elapsedSeconds: number;
  missionDurationSeconds: number;
  finished: boolean;
  winner: number | null;
  playerTeam: number;
  heatTiers: number[];
  selection: EntityId[];
  /** Lance elements the player has bound to the number keys. */
  controlGroups: Record<number, EntityId[]>;
  orderMode: OrderMode;
  /** A phone has no Shift key, so route-building persists across successive taps. */
  queueOrders: boolean;
  formationPreset: FormationPreset;
  calledShotLocation: MechLocation | null;
  units: UnitSnapshot[];
  enemies: UnitSnapshot[];
  log: string[];

  skirmishMissionId: string;
  battleCode: string;
  difficulty: string;
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
  /** The drag-select box in screen pixels, while one is open. */
  marquee: { x: number; y: number; width: number; height: number } | null;
  /** To-hit readout for the primary selection, or null with nothing to price. */
  hitPreview: HitPreviewView | null;
}

export interface GameActions {
  enterBattle: (entry?: BattleEntry) => void;
  setSelection: (ids: EntityId[]) => void;
  assignControlGroup: (slot: number, ids: EntityId[]) => void;
  setOrderMode: (mode: OrderMode) => void;
  setFormationPreset: (preset: FormationPreset) => void;
  setSupportMode: (call: SupportCallId | null) => void;
  setCalledShotLocation: (location: MechLocation | null) => void;
  patch: (partial: Partial<GameState>) => void;
  pushLog: (line: string) => void;
}

const LOG_LIMIT = 60;
const INITIAL_SKIRMISH_MISSION = initialSkirmishMission();

export const useGame = create<GameState & GameActions>((set) => ({
  screen: 'home',
  campaignPending: false,
  ready: false,
  error: null,
  paused: false,
  speed: 1,
  tick: 0,
  elapsedSeconds: 0,
  missionDurationSeconds: 0,
  finished: false,
  winner: null,
  playerTeam: 0,
  heatTiers: [],
  selection: [],
  controlGroups: {},
  orderMode: null,
  queueOrders: false,
  formationPreset: 'auto',
  calledShotLocation: null,
  units: [],
  enemies: [],
  log: [],

  skirmishMissionId: INITIAL_SKIRMISH_MISSION,
  battleCode: initialBattleCode(INITIAL_SKIRMISH_MISSION),
  difficulty: readDifficulty(),
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
  marquee: null,
  hitPreview: null,

  enterBattle: (entry = {}) =>
    set((state) => ({
      screen: 'battle',
      campaignPending: entry.campaignPending ?? false,
      ready: false,
      error: null,
      paused: true,
      speed: 1,
      tick: 0,
      elapsedSeconds: 0,
      missionDurationSeconds: 0,
      finished: false,
      winner: null,
      playerTeam: 0,
      heatTiers: [],
      selection: [],
      controlGroups: {},
      orderMode: null,
      queueOrders: false,
      calledShotLocation: null,
      units: [],
      enemies: [],
      log: [],
      skirmishMissionId: entry.missionId ?? state.skirmishMissionId,
      battleCode: entry.battleCode ?? state.battleCode,
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
      marquee: null,
      hitPreview: null,
    })),
  setSelection: (ids) => set({ selection: ids }),
  assignControlGroup: (slot, ids) =>
    set((state) => ({ controlGroups: { ...state.controlGroups, [slot]: ids } })),
  setOrderMode: (mode) => set({ orderMode: mode, supportMode: null }),
  setFormationPreset: (formationPreset) => set({ formationPreset }),
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
