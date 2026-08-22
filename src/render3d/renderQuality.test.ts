import { describe, expect, it } from 'vitest';
import { detailed, part } from '../render/blueprint/parts';
import {
  battlefieldDetailForDistance,
  HERO_MECH_RENDER,
  includesDetail,
  SURFACE_DETAIL_ENTER_DISTANCE,
  SURFACE_DETAIL_LEAVE_DISTANCE,
  TACTICAL_MECH_RENDER,
} from './renderQuality';

describe('render quality', () => {
  it('keeps authored parts structural unless they opt into closer detail', () => {
    const structure = part('head', 'box', [0, 0, 0], [1, 1, 1], 'plate');
    expect(structure.detail).toBe('structure');
    expect(detailed(structure, 'surface').detail).toBe('surface');
    expect(structure.detail).toBe('structure');
  });

  it('reserves hero geometry and detail for the inspection model', () => {
    expect(TACTICAL_MECH_RENDER).toEqual({ geometry: 'tactical', detail: 'structure' });
    expect(HERO_MECH_RENDER).toEqual({ geometry: 'hero', detail: 'hero' });
    expect(includesDetail('structure', 'surface')).toBe(false);
    expect(includesDetail('surface', 'surface')).toBe(true);
    expect(includesDetail('hero', 'surface')).toBe(true);
    expect(includesDetail('hero', 'hero')).toBe(true);
  });

  it('uses a dead band around the surface-detail boundary', () => {
    expect(battlefieldDetailForDistance(SURFACE_DETAIL_ENTER_DISTANCE, false)).toBe('surface');
    expect(battlefieldDetailForDistance(SURFACE_DETAIL_ENTER_DISTANCE + 1, false)).toBe('structure');
    expect(
      battlefieldDetailForDistance(SURFACE_DETAIL_LEAVE_DISTANCE - 1, false, 'surface'),
    ).toBe('surface');
    expect(
      battlefieldDetailForDistance(SURFACE_DETAIL_LEAVE_DISTANCE, false, 'surface'),
    ).toBe('structure');
  });

  it('forces structural detail for low graphics and invalid camera readings', () => {
    expect(battlefieldDetailForDistance(100, true, 'surface')).toBe('structure');
    expect(battlefieldDetailForDistance(Number.NaN, false, 'surface')).toBe('structure');
  });
});
