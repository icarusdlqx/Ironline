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
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
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
  return writeProjectileTrack(emptyProjectileTrack(), from, to.x, to.y, to.z, arc, velocity);
}

export function emptyProjectileTrack(): ProjectileTrack {
  return {
    fromX: 0,
    fromY: 0,
    fromZ: 0,
    toX: 0,
    toY: 0,
    toZ: 0,
    arc: 0,
    duration: 0.001,
  };
}

/** A pool owns the vectors once, then events only copy their scalar values. */
export function writeProjectileTrack(
  track: ProjectileTrack,
  from: Vector3,
  toX: number,
  toY: number,
  toZ: number,
  arc: number,
  velocity: number,
): ProjectileTrack {
  track.fromX = from.x;
  track.fromY = from.y;
  track.fromZ = from.z;
  track.toX = toX;
  track.toY = toY;
  track.toZ = toZ;
  track.arc = arc;
  const dx = toX - from.x;
  const dy = toY - from.y;
  const dz = toZ - from.z;
  track.duration = Math.max(0.001, Math.hypot(dx, dy, dz) / Math.max(1, velocity));
  return track;
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
  // A layer may retire while another is still rendering, so their GPU owners cannot overlap.
  const mesh = new InstancedMesh(projectileGeometry(style).clone(), material, count);
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
  POSITION.set(
    track.fromX + (track.toX - track.fromX) * at,
    track.fromY + (track.toY - track.fromY) * at,
    track.fromZ + (track.toZ - track.fromZ) * at,
  );
  POSITION.y += Math.sin(at * Math.PI) * track.arc;
  TANGENT.set(
    track.toX - track.fromX,
    track.toY - track.fromY,
    track.toZ - track.fromZ,
  );
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
