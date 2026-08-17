import type { TerrainMapData } from '../schema/map';
import type { SimEvent } from '../sim/events';
import type { Vec2 } from '../sim/types';

export type AbilityVoice = 'aim' | 'evade' | 'sensor' | 'coolant' | 'brace' | 'mixed';
export type FootfallSurface = 'open' | 'road' | 'rough' | 'forest' | 'water';
export type HeatTier = 0 | 1 | 2 | 3;
export type HeatCue = Exclude<HeatTier, 0>;

export interface EventCueSummary {
  abilityCount: number;
  abilityVoice: AbilityVoice | null;
  alphaCount: number;
  missionMessage: boolean;
}

export interface HeatTransition {
  tier: HeatTier;
  cue: HeatCue | null;
}

const ABILITY_VOICES: Readonly<Record<string, Exclude<AbilityVoice, 'mixed'>>> = {
  aimed_volley: 'aim',
  steady_aim: 'aim',
  evasive_burn: 'evade',
  sensor_sweep: 'sensor',
  coolant_flush: 'coolant',
  brace: 'brace',
};

/** One cue per command batch keeps a selected lance from sounding like an arcade cabinet. */
export function summariseEventCues(events: readonly SimEvent[]): EventCueSummary {
  const abilityVoices = new Set<AbilityVoice>();
  let abilityCount = 0;
  let alphaCount = 0;
  let missionMessage = false;

  for (const event of events) {
    if (event.type === 'ability_used') {
      abilityCount += 1;
      abilityVoices.add(ABILITY_VOICES[event.abilityId] ?? 'mixed');
    } else if (event.type === 'alpha_strike') {
      alphaCount += 1;
    } else if (event.type === 'mission_message') {
      missionMessage = true;
    }
  }

  return {
    abilityCount,
    abilityVoice:
      abilityVoices.size === 0
        ? null
        : abilityVoices.size === 1
          ? (abilityVoices.values().next().value ?? null)
          : 'mixed',
    alphaCount,
    missionMessage,
  };
}

/** Hysteresis lets a cooling reactor cross a painted threshold without nagging. */
export function advanceHeatTier(previous: HeatTier, fraction: number): HeatTransition {
  const rising = heatTierAt(fraction);
  if (rising > previous) return { tier: rising, cue: rising as HeatCue };

  if (previous === 3 && fraction < 0.85) return { tier: 2, cue: null };
  if (previous === 2 && fraction < 0.74) return { tier: rising, cue: null };
  if (previous === 1 && fraction < 0.6) return { tier: 0, cue: null };
  return { tier: previous, cue: null };
}

function heatTierAt(fraction: number): HeatTier {
  if (fraction >= 0.93) return 3;
  if (fraction >= 0.82) return 2;
  if (fraction >= 0.68) return 1;
  return 0;
}

/** The authored map retains names that the simulation correctly reduces to effects. */
export function footfallSurfaceAt(map: TerrainMapData | null, at: Vec2): FootfallSurface {
  if (map === null) return 'open';
  const column = Math.floor(at.x / map.tileSize);
  const row = Math.floor(at.y / map.tileSize);
  if (column < 0 || row < 0 || column >= map.width || row >= map.height) return 'open';
  const symbol = map.tiles[row]?.[column];
  const id = symbol === undefined ? undefined : map.legend[symbol];
  switch (id) {
    case 'road':
    case 'rough':
    case 'forest':
    case 'water':
      return id;
    default:
      return 'open';
  }
}
