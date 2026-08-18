import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import { buildMechModel, disposeModel } from './mechModel';

describe('mech model resources', () => {
  it('disposes shared and unattached owned resources once', () => {
    const root = new Group();
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const unused = new MeshStandardMaterial();
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    root.userData.ownedMaterials = [material, material, unused];
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const unusedDispose = vi.spyOn(unused, 'dispose');

    disposeModel(root);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(unusedDispose).toHaveBeenCalledTimes(1);
  });

  it('builds hip, knee and ankle pivots without adding visible parts', () => {
    const chassis = catalog.chassis.get('sentinel_snl2');
    expect(chassis).toBeDefined();
    if (chassis === undefined) return;
    const model = buildMechModel(
      chassis.silhouette,
      chassis.traits,
      chassis.tonnage,
      0x78c9ff,
      false,
      [],
      new Set(),
      chassis.hardpoints,
      chassis.id,
    );

    expect(model.motion?.form).toBe('humanoid');
    expect(model.legReach).toBeGreaterThan(model.strideLength);
    expect(model.root.rotation.order).toBe('YXZ');
    expect(model.torso.rotation.order).toBe('YXZ');
    expect(model.legs).toHaveLength(2);
    for (const leg of model.legs) {
      expect(leg.knee.parent).toBe(leg.hip);
      expect(leg.ankle.parent).toBe(leg.knee);
      expect(leg.ankle.children.length).toBeGreaterThan(0);
    }
    disposeModel(model.root);
  });
});
