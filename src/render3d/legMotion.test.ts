import { describe, expect, it } from 'vitest';
import {
  ankleCounterRotation,
  resetLegPose,
  writeJumpPose,
  writeStridePose,
  writeTurnPose,
  type LegPose,
} from './legMotion';

function pose(): LegPose {
  return { hip: 0, knee: 0, ankle: 0, planted: true };
}

describe('articulated leg poses', () => {
  it('holds the stance arc at one rate and returns through a lifted swing', () => {
    const leg = pose();
    writeStridePose(leg, 0, 0.4, 0.6, 0);
    expect(leg).toMatchObject({ hip: 0.4, knee: 0, planted: true });

    writeStridePose(leg, Math.PI / 2, 0.4, 0.6, 0);
    expect(leg.hip).toBeCloseTo(0);
    expect(leg.knee).toBe(0);
    expect(leg.planted).toBe(true);

    writeStridePose(leg, Math.PI / 4, 0.4, 0.6, 0);
    expect(Math.sin(leg.hip)).toBeCloseTo(Math.sin(0.4) * 0.5, 10);

    writeStridePose(leg, Math.PI * 1.5, 0.4, 0.6, 0);
    expect(leg.hip).toBeCloseTo(0);
    expect(leg.knee).toBeCloseTo(-0.6);
    expect(leg.planted).toBe(false);
  });

  it('counter-rotates the ankle against the leg and acceleration lean', () => {
    const leg = pose();
    writeStridePose(leg, Math.PI * 1.25, 0.38, 0.52, -0.06);

    expect(leg.hip + leg.knee + leg.ankle - 0.06).toBeCloseTo(0, 10);
    expect(ankleCounterRotation(0.2, -0.4, 0.1)).toBeCloseTo(0.1);
  });

  it('tucks both legs in flight without inventing a planted foot', () => {
    const left = pose();
    const right = pose();
    writeJumpPose(left, 0.5, 0.8, -1);
    writeJumpPose(right, 0.5, 0.8, 1);

    expect(left.knee).toBeCloseTo(-0.8);
    expect(right.knee).toBeCloseTo(-0.8);
    expect(left.hip).not.toBe(right.hip);
    expect(left.planted).toBe(false);
    expect(right.planted).toBe(false);

    resetLegPose(left);
    expect(left).toEqual({ hip: 0, knee: 0, ankle: 0, planted: true });
  });

  it('reverses the planted arc across the hull centreline', () => {
    const left = pose();
    const right = pose();
    writeTurnPose(left, Math.PI * 0.75, 0.3, 0.5, -1, 1);
    writeTurnPose(right, Math.PI * 2.75, 0.3, 0.5, 1, 1);

    expect(left.planted).toBe(true);
    expect(right.planted).toBe(true);
    expect(left.hip).toBeLessThan(0);
    expect(right.hip).toBeGreaterThan(0);
  });
});
