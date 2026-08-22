import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { collectLocationAnchors, locationWorldAnchor } from './locationAnchors';
import { markBlueprintDetail } from './modelDetail';

function locatedMesh(x: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.position.x = x;
  mesh.userData.damageLocation = 'centre_torso';
  return mesh;
}

describe('location anchors', () => {
  it('derives combat feedback only from structural blueprint parts', () => {
    const root = new Group();
    const left = locatedMesh(0);
    const right = locatedMesh(2);
    const surface = locatedMesh(100);
    const hero = locatedMesh(200);
    markBlueprintDetail(left, 'structure');
    markBlueprintDetail(right, 'structure');
    markBlueprintDetail(surface, 'surface');
    markBlueprintDetail(hero, 'hero');
    root.add(left, right, surface, hero);

    const anchors = collectLocationAnchors(root);
    const out = new Vector3();

    expect(anchors.centre_torso).toEqual([left, right]);
    expect(locationWorldAnchor(anchors, 'centre_torso', out)).toBe(true);
    expect(out.toArray()).toEqual([1, 0, 0]);
  });

  it('keeps untagged legacy meshes in the structural anchor set', () => {
    const root = new Group();
    const legacy = locatedMesh(3);
    root.add(legacy);

    expect(collectLocationAnchors(root).centre_torso).toEqual([legacy]);
  });
});
