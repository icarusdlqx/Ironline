import {
  type BufferGeometry,
  CylinderGeometry,
  Mesh,
  SphereGeometry,
} from 'three';
import type { BlueprintPart } from '../render/blueprint';
import { armourShell, chamferedBox, hullSlab, taperedLimb } from './panels';
import type { MechGeometryQuality } from './renderQuality';

const SHADOW_CASTER_MIN_RADIUS = 2.4;

export function castsMechShadow(mesh: Mesh): boolean {
  const geometry = mesh.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  return (geometry.boundingSphere?.radius ?? 0) >= SHADOW_CASTER_MIN_RADIUS;
}

export function geometryForBlueprintPart(
  part: BlueprintPart,
  scale: number,
  quality: MechGeometryQuality = 'tactical',
): BufferGeometry {
  const [width, height, depth] = part.size;
  // Profiles are authored only where an outline changes the machine's read.
  if (part.profile !== undefined && part.transverse !== undefined) {
    return armourShell(
      part.profile.map(([x, y]) => [x * width * scale, y * height * scale] as [number, number]),
      depth * scale,
      part.transverse,
    );
  }
  if (part.profile !== undefined) {
    return hullSlab(
      part.profile.map(([x, y]) => [x * width * scale, y * height * scale] as [number, number]),
      depth * scale,
      quality,
    );
  }
  if (part.shape === 'cylinder') {
    const segments = quality === 'hero' ? 20 : 12;
    return new CylinderGeometry(width * scale / 2, width * scale / 2, height * scale, segments);
  }
  if (part.shape === 'sphere') {
    const segments = quality === 'hero' ? [24, 18] as const : [16, 12] as const;
    return new SphereGeometry(width * scale / 2, ...segments);
  }
  if (part.shape === 'limb') {
    return taperedLimb(width * scale / 2, depth * scale / 2, height * scale, quality);
  }
  return chamferedBox(width * scale, height * scale, depth * scale, quality);
}
