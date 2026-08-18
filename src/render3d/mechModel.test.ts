import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeModel } from './mechModel';

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
});
