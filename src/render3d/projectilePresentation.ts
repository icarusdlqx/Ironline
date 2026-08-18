import {
  BoxGeometry,
  BufferGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { Weapon } from '../schema/weapon';

export type ShotStyle = Weapon['visual']['style'];

export interface ProjectileTrack {
  from: Vector3;
  to: Vector3;
  arc: number;
  duration: number;
}

const FORWARD = new Vector3(1, 0, 0);
const POSITION = new Vector3();
const TANGENT = new Vector3();
const INSTANCE = new Object3D();
const SHELL_GEOMETRY = new BoxGeometry(4.2, 1.1, 1.1);
const SLUG_GEOMETRY = new BoxGeometry(7.5, 0.7, 0.7);
const MISSILE_GEOMETRY = new BoxGeometry(5, 1.4, 1.4);

export function projectileTrack(
  from: Vector3,
  to: Vector3,
  arc: number,
  velocity: number,
): ProjectileTrack {
  return {
    from: from.clone(),
    to: to.clone(),
    arc,
    duration: Math.max(0.001, from.distanceTo(to) / Math.max(1, velocity)),
  };
}

export function projectileMesh(style: ShotStyle, material: MeshBasicMaterial): Mesh {
  return new Mesh(projectileGeometry(style), material);
}

/** A canister or salvo stays one draw call while every round keeps its own path. */
export function projectileBatch(
  style: ShotStyle,
  material: MeshBasicMaterial,
  count: number,
): InstancedMesh {
  const mesh = new InstancedMesh(projectileGeometry(style), material, count);
  // Instance bounds move every frame; recomputing them costs more than these short-lived rounds.
  mesh.frustumCulled = false;
  return mesh;
}

export function placeProjectile(
  mesh: Object3D,
  track: ProjectileTrack,
  progress: number,
  width: number,
): void {
  const at = Math.max(0, Math.min(1, progress));
  POSITION.lerpVectors(track.from, track.to, at);
  POSITION.y += Math.sin(at * Math.PI) * track.arc;
  TANGENT.subVectors(track.to, track.from);
  TANGENT.y += Math.cos(at * Math.PI) * Math.PI * track.arc;

  mesh.position.copy(POSITION);
  mesh.quaternion.setFromUnitVectors(FORWARD, TANGENT.normalize());
  const girth = Math.max(0.55, width * 0.42);
  mesh.scale.set(1, girth, girth);
}

export function placeProjectileInstance(
  mesh: InstancedMesh,
  index: number,
  track: ProjectileTrack,
  progress: number,
  width: number,
): void {
  placeProjectile(INSTANCE, track, progress, width);
  INSTANCE.updateMatrix();
  mesh.setMatrixAt(index, INSTANCE.matrix);
}

function projectileGeometry(style: ShotStyle): BufferGeometry {
  if (style === 'missile') return MISSILE_GEOMETRY;
  if (style === 'slug') return SLUG_GEOMETRY;
  return SHELL_GEOMETRY;
}
