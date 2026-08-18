import { Euler, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog, testWorld, unitOf } from '../../tests/support';
import { normaliseAngle } from '../sim/math';
import type { BattleEffects } from './battleEffects';
import { buildMechModel, disposeModel } from './mechModel';
import { turnStrideLength } from './motionProfiles';
import {
  advanceGait,
  gaitForTerrain,
  localTilt,
  Locomotion,
  responseBlend,
  sampleGround,
  type GaitProfile,
} from './locomotion';

function walkingHarness(
  heightAt: (x: number, y: number) => number = () => 0,
  designId = 'sentinel_brawler',
) {
  const world = testWorld('render-gait');
  const entity = unitOf(world, designId);
  const chassis = catalog.chassis.get(entity.chassisId);
  if (chassis === undefined) throw new Error(`unknown chassis ${entity.chassisId}`);
  const effects = {
    land: vi.fn(),
    plume: vi.fn(),
  } as unknown as BattleEffects;
  const model = buildMechModel(
    chassis.silhouette,
    chassis.traits,
    entity.tonnage,
    0x78c9ff,
    false,
    [],
    new Set(),
    chassis.hardpoints,
    chassis.id,
  );
  const locomotion = new Locomotion(heightAt, () => 'open', effects);
  return { entity, model, locomotion };
}

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

  it('keeps articulated boots parallel to a local slope', () => {
    const terrain = (x: number): number => x * 0.2;
    const { entity, model, locomotion } = walkingHarness(terrain);
    locomotion.place(entity, model, { x: 0, y: 0, facing: 0, torso: 0 }, 0, 1 / 60);
    locomotion.place(
      entity,
      model,
      { x: model.strideLength * 0.55, y: 0, facing: 0, torso: 0 },
      0,
      0.2,
    );

    const groundPitch = localTilt(0.2, 0, 0).z;
    for (const leg of model.legs) {
      const footPitch =
        model.root.rotation.z + leg.hip.rotation.z + leg.knee.rotation.z + leg.ankle.rotation.z;
      expect(footPitch).toBeCloseTo(groundPitch, 8);
    }
    disposeModel(model.root);
  });

  it('composes yaw before slope in the actual world transform', () => {
    const gradeX = 0.2;
    const gradeY = 0.1;
    const terrain = (x: number, y: number): number => gradeX * x + gradeY * y;
    for (const facing of [0, 0.3, 0.79, Math.PI / 2, 2.2, 3]) {
      const { entity, model, locomotion } = walkingHarness(terrain);
      locomotion.place(entity, model, { x: 20, y: 30, facing, torso: 0 }, 0, 1 / 60);
      model.root.updateMatrixWorld(true);
      const nose = new Vector3(1, 0, 0).applyQuaternion(model.root.quaternion);
      const left = new Vector3(0, 0, 1).applyQuaternion(model.root.quaternion);

      expect(nose.y).toBeCloseTo(gradeX * nose.x + gradeY * nose.z, 2);
      expect(left.y).toBeCloseTo(gradeX * left.x + gradeY * left.z, 2);
      disposeModel(model.root);
    }
  });

  it.each(['sentinel_brawler', 'hornet_spotter'])(
    'holds a %s ankle in world space through a flat-ground stance',
    (designId) => {
      const { entity, model, locomotion } = walkingHarness(() => 0, designId);
      locomotion.place(entity, model, { x: 0, y: 0, facing: 0, torso: 0 }, 0, 0.2);
      model.root.updateMatrixWorld(true);
      const anchor = model.legs[0]?.ankle.getWorldPosition(new Vector3());
      expect(anchor).toBeDefined();
      if (anchor === undefined) return;

      locomotion.place(
        entity,
        model,
        { x: model.strideLength * 0.25, y: 0, facing: 0, torso: 0 },
        0,
        0.2,
      );
      model.root.updateMatrixWorld(true);
      const planted = model.legs[0]?.ankle.getWorldPosition(new Vector3());
      expect(planted).toBeDefined();
      expect(planted?.distanceTo(anchor)).toBeLessThan(0.02);
      disposeModel(model.root);
    },
  );

  it.each([
    ['sentinel_brawler', -1],
    ['sentinel_brawler', 1],
    ['hornet_spotter', -1],
    ['hornet_spotter', 1],
  ] as const)(
    'replants %s through a continuous %s turn',
    (designId, direction) => {
      const { entity, model, locomotion } = walkingHarness(() => 0, designId);
      let facing = direction > 0 ? 3.04 : -3.04;
      locomotion.place(entity, model, { x: 0, y: 0, facing, torso: 0 }, 0, 1 / 30);
      model.root.updateMatrixWorld(true);
      let plantedIndex = 0;
      let anchor = model.legs[plantedIndex]?.ankle.getWorldPosition(new Vector3());
      expect(anchor).toBeDefined();
      if (anchor === undefined) return;

      const stride = turnStrideLength(model.strideLength, model.turnRadius);
      let cumulative = 0;
      let switches = 0;
      let maximumError = 0;
      let wrapped = false;
      for (let frame = 0; frame < 120; frame += 1) {
        const previousFacing = facing;
        facing = normaliseAngle(facing + direction * 0.025);
        if (Math.abs(facing - previousFacing) > Math.PI) wrapped = true;
        cumulative += 0.025;
        locomotion.place(entity, model, { x: 0, y: 0, facing, torso: 0 }, 0, 1 / 30);
        model.root.updateMatrixWorld(true);

        const phase = Math.PI / 2 + (cumulative * model.turnRadius * Math.PI) / stride;
        const nextIndex = Math.abs(Math.floor(phase / Math.PI)) % 2;
        const ankle = model.legs[nextIndex]?.ankle.getWorldPosition(new Vector3());
        expect(ankle).toBeDefined();
        if (ankle === undefined) return;
        if (nextIndex !== plantedIndex) {
          plantedIndex = nextIndex;
          anchor = ankle;
          switches += 1;
        } else {
          maximumError = Math.max(maximumError, ankle.distanceTo(anchor));
        }
      }

      expect(switches).toBeGreaterThanOrEqual(2);
      expect(wrapped).toBe(true);
      expect(maximumError).toBeLessThan(model.turnRadius * 0.025);
      disposeModel(model.root);
    },
  );

  it('tucks for a jump and never reports an airborne footfall', () => {
    const { entity, model, locomotion } = walkingHarness((_x, y) => -y);
    const footfall = vi.fn();
    locomotion.onFootfall = footfall;
    locomotion.place(entity, model, { x: 0, y: 0, facing: 0, torso: 0 }, 0, 1 / 60);
    expect(model.legs.some((leg) =>
      Math.abs(leg.ankle.rotation.x) + Math.abs(leg.ankle.rotation.y) > 0.1,
    )).toBe(true);

    entity.jump = { from: { x: 0, y: 0 }, to: { x: 90, y: 0 }, elapsed: 0.5, duration: 1 };
    locomotion.place(entity, model, { x: 45, y: 0, facing: 0, torso: 0 }, 10, 0.1);
    expect(model.legs.every((leg) => leg.knee.rotation.z < -0.4)).toBe(true);
    expect(model.legs.every((leg) => leg.ankle.rotation.x === 0 && leg.ankle.rotation.y === 0))
      .toBe(true);
    expect(footfall).not.toHaveBeenCalled();

    entity.jump.elapsed = 0.75;
    locomotion.place(entity, model, { x: 68, y: 0, facing: 0, torso: 0 }, 7, 0.1);
    expect(footfall).not.toHaveBeenCalled();

    entity.jump = null;
    locomotion.place(entity, model, { x: 90, y: 0, facing: 0, torso: 0 }, 0, 0.1);
    expect(model.legs.every((leg) =>
      leg.hip.rotation.z === 0 && leg.knee.rotation.z === 0 && leg.ankle.rotation.z === 0,
    )).toBe(true);
    expect(footfall).not.toHaveBeenCalled();
    disposeModel(model.root);
  });

  it('drops stale gait state when an interpolated unit teleports', () => {
    const { entity, model, locomotion } = walkingHarness((_x, y) => -y);
    const footfall = vi.fn();
    locomotion.onFootfall = footfall;
    locomotion.place(entity, model, { x: 0, y: 0, facing: 0, torso: 0 }, 0, 1 / 60);
    locomotion.place(
      entity,
      model,
      { x: model.strideLength * 0.6, y: 0, facing: 0, torso: 0 },
      0,
      0.2,
    );
    expect(model.legs.some((leg) => Math.abs(leg.hip.rotation.z) > 0.01)).toBe(true);
    expect(model.legs.some((leg) =>
      Math.abs(leg.ankle.rotation.x) + Math.abs(leg.ankle.rotation.y) > 0.1,
    )).toBe(true);
    footfall.mockClear();

    locomotion.place(
      entity,
      model,
      { x: model.strideLength * 4, y: 0, facing: 0, torso: 0 },
      0,
      0.1,
    );
    for (const leg of model.legs) {
      expect(leg.hip.rotation.z).toBe(0);
      expect(leg.knee.rotation.z).toBe(0);
      expect(leg.ankle.rotation.x).toBeCloseTo(0);
      expect(leg.ankle.rotation.y).toBeCloseTo(0);
      expect(leg.ankle.rotation.z).toBe(0);
    }
    expect(model.torso.position.y).toBe(model.torsoRestY);
    expect(footfall).not.toHaveBeenCalled();
    disposeModel(model.root);
  });
});
