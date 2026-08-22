import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';
import { armoured, part, shaped } from '../render/blueprint/parts';
import { PROFILES } from '../render/blueprint/profiles';
import { castsMechShadow, geometryForBlueprintPart } from './mechGeometry';

function triangles(geometry: ReturnType<typeof geometryForBlueprintPart>): number {
  return geometry.index === null
    ? geometry.getAttribute('position').count / 3
    : geometry.index.count / 3;
}

describe('mech geometry', () => {
  it('keeps the battlefield primitive tessellation as the default', () => {
    const cylinder = geometryForBlueprintPart(
      part('head', 'cylinder', [0, 0, 0], [2, 3, 2], 'plate'),
      1,
    );
    const sphere = geometryForBlueprintPart(
      part('head', 'sphere', [0, 0, 0], [2, 2, 2], 'plate'),
      1,
    );

    expect(cylinder).toBeInstanceOf(CylinderGeometry);
    expect(sphere).toBeInstanceOf(SphereGeometry);
    if (!(cylinder instanceof CylinderGeometry) || !(sphere instanceof SphereGeometry)) return;
    expect(cylinder.parameters.radialSegments).toBe(12);
    expect(sphere.parameters.widthSegments).toBe(16);
    expect(sphere.parameters.heightSegments).toBe(12);
  });

  it.each([
    part('head', 'box', [0, 0, 0], [2, 2, 2], 'plate'),
    part('left_leg', 'limb', [0, 0, 0], [2, 3, 1.5], 'plate'),
    part('head', 'sphere', [0, 0, 0], [2, 2, 2], 'plate'),
    part('head', 'cylinder', [0, 0, 0], [2, 3, 2], 'plate'),
    shaped('centre_torso', PROFILES.block, [0, 0, 0], [2, 2, 2], 'plate'),
  ])('spends more triangles only on hero geometry', (piece) => {
    const tactical = geometryForBlueprintPart(piece, 1, 'tactical');
    const hero = geometryForBlueprintPart(piece, 1, 'hero');

    expect(triangles(hero)).toBeGreaterThan(triangles(tactical));
  });

  it('keeps authored transverse armour topology independent of presentation quality', () => {
    const piece = armoured(
      'centre_torso',
      PROFILES.block,
      [0, 0, 0],
      [2, 2, 2],
      'plate',
      { front: 0.7 },
    );

    expect(triangles(geometryForBlueprintPart(piece, 1, 'hero'))).toBe(
      triangles(geometryForBlueprintPart(piece, 1, 'tactical')),
    );
  });

  it('limits shadow casters to silhouette-scale pieces', () => {
    const material = new MeshBasicMaterial();
    expect(castsMechShadow(new Mesh(new BoxGeometry(2, 2, 2), material))).toBe(false);
    expect(castsMechShadow(new Mesh(new BoxGeometry(4, 4, 4), material))).toBe(true);
  });
});
