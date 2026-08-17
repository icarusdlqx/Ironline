import { describe, expect, it } from 'vitest';
import type { TerrainMapData } from '../schema/map';
import type { SimEvent } from '../sim/events';
import { advanceHeatTier, footfallSurfaceAt, summariseEventCues } from './audioCues';

const MAP: TerrainMapData = {
  id: 'sound_test',
  name: 'Sound Test',
  tileSize: 10,
  width: 5,
  height: 4,
  legend: { '.': 'open', '=': 'road', r: 'rough', f: 'forest', w: 'water' },
  tiles: ['.=rfw', '.=rfw', '.=rfw', '.=rfw'],
  atmosphereId: 'overcast_day',
};

describe('audio cue selection', () => {
  it('collapses a selected lance into one ability voice', () => {
    const events: SimEvent[] = [
      { type: 'ability_used', tick: 10, entityId: 1, abilityId: 'steady_aim' },
      { type: 'ability_used', tick: 10, entityId: 2, abilityId: 'aimed_volley' },
    ];
    expect(summariseEventCues(events)).toMatchObject({
      abilityCount: 2,
      abilityVoice: 'aim',
    });
  });

  it('uses one mixed cue when several ability families fire together', () => {
    const events: SimEvent[] = [
      { type: 'ability_used', tick: 10, entityId: 1, abilityId: 'sensor_sweep' },
      { type: 'ability_used', tick: 10, entityId: 2, abilityId: 'coolant_flush' },
      { type: 'ability_used', tick: 10, entityId: 3, abilityId: 'brace' },
    ];
    expect(summariseEventCues(events).abilityVoice).toBe('mixed');
  });

  it('gives an unauthored future ability the neutral mixed cue', () => {
    const events: SimEvent[] = [
      { type: 'ability_used', tick: 10, entityId: 1, abilityId: 'field_repair' },
    ];
    expect(summariseEventCues(events).abilityVoice).toBe('mixed');
  });

  it('counts one alpha cue and one radio cue per event batch', () => {
    const events: SimEvent[] = [
      { type: 'alpha_strike', tick: 10, entityId: 1 },
      { type: 'alpha_strike', tick: 10, entityId: 2 },
      { type: 'mission_message', tick: 10, text: 'First call.' },
      { type: 'mission_message', tick: 10, text: 'Second call.' },
    ];
    expect(summariseEventCues(events)).toMatchObject({ alphaCount: 2, missionMessage: true });
  });
});

describe('heat warning tiers', () => {
  it('climbs once at each threshold', () => {
    expect(advanceHeatTier(0, 0.67)).toEqual({ tier: 0, cue: null });
    expect(advanceHeatTier(0, 0.68)).toEqual({ tier: 1, cue: 1 });
    expect(advanceHeatTier(1, 0.82)).toEqual({ tier: 2, cue: 2 });
    expect(advanceHeatTier(2, 0.93)).toEqual({ tier: 3, cue: 3 });
  });

  it('needs real cooling before a threshold can sound again', () => {
    expect(advanceHeatTier(2, 0.79)).toEqual({ tier: 2, cue: null });
    expect(advanceHeatTier(2, 0.73)).toEqual({ tier: 1, cue: null });
    expect(advanceHeatTier(1, 0.82)).toEqual({ tier: 2, cue: 2 });
    expect(advanceHeatTier(1, 0.59)).toEqual({ tier: 0, cue: null });
  });

  it('does not rearm the middle warning while leaving the top tier', () => {
    expect(advanceHeatTier(3, 0.8)).toEqual({ tier: 2, cue: null });
    expect(advanceHeatTier(2, 0.82)).toEqual({ tier: 2, cue: null });
  });

  it('uses only the hottest cue when heat jumps several tiers', () => {
    expect(advanceHeatTier(0, 1.05)).toEqual({ tier: 3, cue: 3 });
  });
});

describe('terrain voices', () => {
  it('reads the authored terrain id under the rendered foot', () => {
    expect(footfallSurfaceAt(MAP, { x: 5, y: 5 })).toBe('open');
    expect(footfallSurfaceAt(MAP, { x: 15, y: 5 })).toBe('road');
    expect(footfallSurfaceAt(MAP, { x: 25, y: 5 })).toBe('rough');
    expect(footfallSurfaceAt(MAP, { x: 35, y: 5 })).toBe('forest');
    expect(footfallSurfaceAt(MAP, { x: 45, y: 5 })).toBe('water');
  });

  it('falls back to open ground outside an authored map', () => {
    expect(footfallSurfaceAt(null, { x: 5, y: 5 })).toBe('open');
    expect(footfallSurfaceAt(MAP, { x: -1, y: 5 })).toBe('open');
    expect(footfallSurfaceAt(MAP, { x: 50, y: 5 })).toBe('open');
  });
});
