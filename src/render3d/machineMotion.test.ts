import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog, testWorld, unitOf } from '../../tests/support';
import { chassisBlueprint } from '../render/blueprint';
import type { BattleEffects } from './battleEffects';
import { Locomotion } from './locomotion';
import {
  poseMachineMotion,
  setMachineMotionLowFx,
  type MachineMotionRig,
} from './machineMotion';
import { buildMechModel, disposeModel, type MechModel } from './mechModel';

function modelFor(chassisId: string): MechModel {
  const chassis = catalog.chassis.get(chassisId);
  if (chassis === undefined) throw new Error(`unknown chassis ${chassisId}`);
  return buildMechModel(
    chassis.silhouette,
    chassis.traits,
    chassis.tonnage,
    0x78c9ff,
    false,
    [],
    new Set(),
    chassis.hardpoints,
    chassis.id,
    {},
    chassis.faction,
  );
}

function instanceMatrix(rig: MachineMotionRig, index = 0): Matrix4 {
  const matrix = new Matrix4();
  rig.pistons?.getMatrixAt(index, matrix);
  return matrix;
}

function localEndpoint(
  model: MechModel,
  node: MachineMotionRig['links'][number]['from'],
  offset: readonly [number, number, number],
): Vector3 {
  model.root.updateWorldMatrix(true, true);
  const world = new Vector3(...offset).applyMatrix4(node.matrixWorld);
  return model.root.worldToLocal(world);
}

describe('linewrought machine motion', () => {
  it('adds one four-instance structural batch only to a welded walker', () => {
    const welded = modelFor('hornet_hnt2');
    const sealed = modelFor('sentinel_snl2');
    try {
      const pistons = welded.machineMotion.pistons;
      expect(pistons).toBeInstanceOf(InstancedMesh);
      expect(pistons?.count).toBe(4);
      expect(welded.machineMotion.links).toHaveLength(4);
      expect(pistons?.parent).toBe(welded.root);
      expect(pistons?.castShadow).toBe(false);
      expect(pistons?.userData.damageLocation).toBeUndefined();
      expect(pistons?.userData.blueprintDetail).toBeUndefined();
      expect(welded.root.userData.ownedMaterials).toContain(pistons?.material);

      expect(sealed.machineMotion.pistons).toBeNull();
      expect(sealed.machineMotion.links).toHaveLength(0);
      expect(sealed.root.getObjectByName('linewrought-pistons')).toBeUndefined();

      const chassis = catalog.chassis.get('hornet_hnt2');
      if (chassis === undefined) throw new Error('missing Hornet');
      const plan = chassisBlueprint(
        chassis.silhouette,
        chassis.traits,
        chassis.hardpoints,
        chassis.id,
      );
      let blueprintMeshes = 0;
      welded.root.traverse((node) => {
        if (node instanceof Mesh && typeof node.userData.blueprintDetail === 'string') {
          blueprintMeshes += 1;
        }
      });
      expect(blueprintMeshes).toBe(
        plan.parts.filter((part) => part.detail !== 'hero').length,
      );
    } finally {
      disposeModel(welded.root);
      disposeModel(sealed.root);
    }
  });

  it('keeps every actuator end on its authored joint points', () => {
    const model = modelFor('hornet_hnt2');
    try {
      const pistons = model.machineMotion.pistons;
      const pair = model.machineMotion.links[0];
      expect(pistons).not.toBeNull();
      expect(pair).toBeDefined();
      if (pistons === null || pair === undefined) return;

      model.legs[0]?.knee.rotation.set(0, 0, -0.48);
      model.legs[0]?.ankle.rotation.set(0, 0, 0.27);
      poseMachineMotion(model.machineMotion);

      const matrix = instanceMatrix(model.machineMotion);
      const low = new Vector3(0, -0.5, 0).applyMatrix4(matrix);
      const high = new Vector3(0, 0.5, 0).applyMatrix4(matrix);
      const from = localEndpoint(model, pair.from, pair.fromOffset);
      const to = localEndpoint(model, pair.to, pair.toOffset);
      expect(Math.min(low.distanceTo(from), high.distanceTo(from))).toBeLessThan(1e-5);
      expect(Math.min(low.distanceTo(to), high.distanceTo(to))).toBeLessThan(1e-5);
      expect(matrix.elements.every(Number.isFinite)).toBe(true);
    } finally {
      disposeModel(model.root);
    }
  });

  it('freezes and hides the optional batch under low FX, then catches up on restore', () => {
    const model = modelFor('hornet_hnt2');
    try {
      const pistons = model.machineMotion.pistons;
      expect(pistons).not.toBeNull();
      if (pistons === null) return;
      const before = [...instanceMatrix(model.machineMotion).elements];

      setMachineMotionLowFx(model.machineMotion, true);
      model.legs[0]?.knee.rotation.set(0, 0, -0.55);
      poseMachineMotion(model.machineMotion);
      expect(pistons.visible).toBe(false);
      expect(instanceMatrix(model.machineMotion).elements).toEqual(before);

      setMachineMotionLowFx(model.machineMotion, false);
      expect(pistons.visible).toBe(true);
      expect(instanceMatrix(model.machineMotion).elements).not.toEqual(before);
    } finally {
      disposeModel(model.root);
    }
  });

  it('is posed by locomotion while the simulation position remains authoritative', () => {
    const world = testWorld('linewrought-piston-gait');
    const entity = unitOf(world, 'hornet_spotter');
    const model = modelFor(entity.chassisId);
    const effects = { land: vi.fn(), plume: vi.fn() } as unknown as BattleEffects;
    const locomotion = new Locomotion(() => 0, () => 'open', effects);
    const originalPosition = { ...entity.pos };
    try {
      locomotion.place(entity, model, { x: 0, y: 0, facing: 0, torso: 0 }, 0, 0.1);
      const standing = [...instanceMatrix(model.machineMotion).elements];
      locomotion.place(
        entity,
        model,
        { x: model.strideLength * 0.4, y: 0, facing: 0, torso: 0 },
        0,
        0.1,
      );

      expect(instanceMatrix(model.machineMotion).elements).not.toEqual(standing);
      expect(entity.pos).toEqual(originalPosition);
    } finally {
      disposeModel(model.root);
    }
  });

  it('releases the one piston geometry through normal model disposal', () => {
    const model = modelFor('hornet_hnt2');
    const pistons = model.machineMotion.pistons;
    const geometry = pistons?.geometry;
    expect(geometry).toBeDefined();
    if (geometry === undefined || pistons === null) return;
    const disposed = vi.fn();
    const instancesDisposed = vi.fn();
    geometry.addEventListener('dispose', disposed);
    pistons.addEventListener('dispose', instancesDisposed);

    disposeModel(model.root);
    disposeModel(model.root);

    expect(disposed).toHaveBeenCalledTimes(1);
    expect(instancesDisposed).toHaveBeenCalledTimes(1);
  });
});
