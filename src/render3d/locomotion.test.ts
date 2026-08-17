import { Euler, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  advanceGait,
  gaitForTerrain,
  localTilt,
  responseBlend,
  sampleGround,
  type GaitProfile,
} from './locomotion';

describe('terrain-following locomotion', () => {
  it('reads a ground plane without changing its centre height', () => {
    const plane = (x: number, y: number): number => 12 + x * 0.25 - y * 0.1;
    const ground = sampleGround(plane, { x: 40, y: 70 }, 15);

    expect(ground.height).toBeCloseTo(plane(40, 70));
    expect(ground.gradeX).toBeCloseTo(0.25);
    expect(ground.gradeY).toBeCloseTo(-0.1);
  });

  it('keeps a world slope stable while a chassis turns across it', () => {
    const eastbound = localTilt(0.2, 0, 0);
    const northbound = localTilt(0.2, 0, Math.PI / 2);

    expect(eastbound.z).toBeCloseTo(Math.atan(0.2));
    expect(eastbound.x).toBeCloseTo(0);
    expect(northbound.z).toBeCloseTo(0);
    expect(northbound.x).toBeCloseTo(Math.atan(0.2));
  });

  it('raises the correct local edges of the model', () => {
    const tilt = localTilt(0.2, 0.1, 0);
    const rotation = new Euler(tilt.x, 0, tilt.z);
    const nose = new Vector3(1, 0, 0).applyEuler(rotation);
    const left = new Vector3(0, 0, 1).applyEuler(rotation);

    expect(nose.y).toBeGreaterThan(0);
    expect(left.y).toBeGreaterThan(0);
  });

  it('uses shorter, higher steps through cluttered ground', () => {
    const open = gaitForTerrain('open');
    const forest = gaitForTerrain('forest');
    const water = gaitForTerrain('water');

    expect(forest.stride).toBeLessThan(open.stride);
    expect(forest.knee).toBeGreaterThan(open.knee);
    expect(forest.bob).toBeLessThan(open.bob);
    expect(water.swing).toBeLessThan(forest.swing);
  });

  it('eases by elapsed time rather than frame count', () => {
    const advance = (frames: number): number => {
      let value = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        value += (1 - value) * responseBlend(9, 1 / frames);
      }
      return value;
    };

    expect(advance(30)).toBeCloseTo(advance(144), 10);
  });

  it('blends a forest gait without depending on display rate', () => {
    const advance = (frames: number): GaitProfile => {
      const gait = { ...gaitForTerrain('open') };
      for (let frame = 0; frame < frames; frame += 1) {
        advanceGait(gait, gaitForTerrain('forest'), 1 / frames);
      }
      return gait;
    };

    const firstFrame = { ...gaitForTerrain('open') };
    advanceGait(firstFrame, gaitForTerrain('forest'), 1 / 60);
    expect(firstFrame.stride).toBeLessThan(gaitForTerrain('open').stride);
    expect(firstFrame.stride).toBeGreaterThan(gaitForTerrain('forest').stride);
    expect(advance(30).stride).toBeCloseTo(advance(144).stride, 10);
    expect(advance(30).knee).toBeCloseTo(advance(144).knee, 10);
  });
});
