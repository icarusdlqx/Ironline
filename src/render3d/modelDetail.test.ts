import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyModelDetail,
  blueprintDetailOf,
  markBlueprintDetail,
} from './modelDetail';

function taggedMesh(detail: 'structure' | 'surface' | 'hero'): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.castShadow = true;
  markBlueprintDetail(mesh, detail);
  return mesh;
}

describe('model detail', () => {
  it('reveals only the detail levels requested by the model', () => {
    const root = new Group();
    const structure = taggedMesh('structure');
    const surface = taggedMesh('surface');
    const hero = taggedMesh('hero');
    const attachment = new Group();
    root.add(structure, surface, hero, attachment);

    applyModelDetail(root, 'structure');
    expect([structure.visible, surface.visible, hero.visible, attachment.visible]).toEqual([
      true,
      false,
      false,
      true,
    ]);

    applyModelDetail(root, 'surface');
    expect([structure.visible, surface.visible, hero.visible, attachment.visible]).toEqual([
      true,
      true,
      false,
      true,
    ]);

    applyModelDetail(root, 'hero');
    expect([structure.visible, surface.visible, hero.visible, attachment.visible]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(root.userData.modelDetail).toBe('hero');
  });

  it('keeps legacy attachments structural and detail plates out of the shadow pass', () => {
    const legacy = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const surface = taggedMesh('surface');

    expect(blueprintDetailOf(legacy)).toBe('structure');
    expect(blueprintDetailOf(surface)).toBe('surface');
    expect(surface.castShadow).toBe(false);
  });
});
