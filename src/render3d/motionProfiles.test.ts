import { describe, expect, it } from 'vitest';
import { gaitForTerrain } from './locomotion';
import {
  motionProfileFor,
  strideLengthFor,
  strideSwing,
  turnStrideLength,
  WALKING_FORMS,
} from './motionProfiles';

describe('chassis motion profiles', () => {
  it('authors weight and recovery for every walking form', () => {
    const profiles = WALKING_FORMS.map((form) => motionProfileFor(form, 55));

    expect(profiles.every((profile) => profile !== null)).toBe(true);
    expect(new Set(profiles.map((profile) => profile?.cadence)).size).toBe(WALKING_FORMS.length);
    expect(profiles.find((profile) => profile?.form === 'scout')?.cadence)
      .toBeGreaterThan(profiles.find((profile) => profile?.form === 'siege')?.cadence ?? 0);
    expect(profiles.find((profile) => profile?.form === 'bird')?.kneeLift)
      .toBeGreaterThan(profiles.find((profile) => profile?.form === 'bastion')?.kneeLift ?? 0);
  });

  it('leaves wheels, tracks and concrete out of the walk cycle', () => {
    for (const form of ['tracked', 'wheeled', 'emplacement'] as const) {
      expect(motionProfileFor(form, 60)).toBeNull();
    }
  });

  it('lets mass slow recovery without changing simulation speed', () => {
    const light = motionProfileFor('humanoid', 25);
    const assault = motionProfileFor('humanoid', 100);
    expect(light).not.toBeNull();
    expect(assault).not.toBeNull();
    if (light === null || assault === null) return;

    expect(assault.cadence).toBeLessThan(light.cadence);
    expect(assault.bob).toBeLessThan(light.bob);
    expect(assault.response).toBeLessThan(light.response);
    expect(assault.lean).toBeGreaterThan(light.lean);
  });

  it('derives the leg arc from the ground-adjusted stride', () => {
    const profile = motionProfileFor('bird', 45);
    expect(profile).not.toBeNull();
    if (profile === null) return;

    const reach = 15;
    const open = strideLengthFor(reach, profile, gaitForTerrain('open'));
    const forest = strideLengthFor(reach, profile, gaitForTerrain('forest'));
    const water = strideLengthFor(reach, profile, gaitForTerrain('water'));
    const swing = strideSwing(open, reach);

    expect(forest).toBeLessThan(open);
    expect(water).toBeLessThan(forest);
    expect(2 * reach * Math.sin(swing)).toBeCloseTo(open, 10);
  });

  it('keeps turn stances short enough to replant before the hull skates sideways', () => {
    expect(turnStrideLength(12, 6)).toBeCloseTo(2.04);
    expect(turnStrideLength(1.5, 6)).toBe(1.5);
  });
});
