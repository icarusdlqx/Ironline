import {
  BoxGeometry,
  CylinderGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type Material,
} from 'three';
import type { Weapon } from '../schema/weapon';
import { chamferedBox } from './panels';
import type { MechGeometryQuality } from './renderQuality';

const INSTANCE = new Object3D();

export interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  pitch?: number;
}

export function weaponHousing(
  name: string,
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  material: Material,
  quality: MechGeometryQuality,
): Mesh {
  const mesh = new Mesh(chamferedBox(...size, quality), material);
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

export function weaponBox(
  name: string,
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  material: Material,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

export function weaponCylinder(
  name: string,
  radiusNear: number,
  radiusFar: number,
  length: number,
  at: readonly [number, number, number],
  material: Material,
  quality: MechGeometryQuality,
): Mesh {
  const segments = quality === 'hero' ? 14 : 8;
  const mesh = new Mesh(
    new CylinderGeometry(radiusFar, radiusNear, length, segments),
    material,
  );
  mesh.name = name;
  mesh.rotation.z = -Math.PI / 2;
  mesh.position.set(...at);
  return mesh;
}

export function cylinderInstances(
  name: string,
  count: number,
  radius: number,
  length: number,
  material: Material,
  quality: MechGeometryQuality,
  place: (index: number) => InstancePlacement,
): InstancedMesh {
  const bounded = Math.max(1, Math.min(40, Math.floor(count)));
  const segments = quality === 'hero' ? 10 : 6;
  const mesh = new InstancedMesh(
    new CylinderGeometry(radius, radius, length, segments),
    material,
    bounded,
  );
  mesh.name = name;
  for (let index = 0; index < bounded; index += 1) {
    const at = place(index);
    INSTANCE.position.set(at.x, at.y, at.z);
    INSTANCE.rotation.set(0, 0, -Math.PI / 2 + (at.pitch ?? 0));
    INSTANCE.scale.set(1, 1, 1);
    INSTANCE.updateMatrix();
    mesh.setMatrixAt(index, INSTANCE.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function boxInstances(
  name: string,
  count: number,
  size: readonly [number, number, number],
  material: Material,
  place: (index: number) => InstancePlacement,
): InstancedMesh {
  const bounded = Math.max(1, Math.min(12, Math.floor(count)));
  const mesh = new InstancedMesh(new BoxGeometry(...size), material, bounded);
  mesh.name = name;
  for (let index = 0; index < bounded; index += 1) {
    const at = place(index);
    INSTANCE.position.set(at.x, at.y, at.z);
    INSTANCE.rotation.set(0, 0, at.pitch ?? 0);
    INSTANCE.scale.set(1, 1, 1);
    INSTANCE.updateMatrix();
    mesh.setMatrixAt(index, INSTANCE.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function weaponGlowMaterial(visual: Weapon['visual']): MeshStandardMaterial {
  const colour = Number.parseInt(visual.colour.slice(1), 16);
  return new MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: 0.72,
    roughness: 0.25,
    metalness: 0.38,
  });
}
