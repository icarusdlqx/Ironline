import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Weapon } from '../schema/weapon';
import type { Vec2 } from '../sim/types';
import {
  placeProjectile,
  placeProjectileInstance,
  projectileBatch,
  projectileMesh,
  projectileTrack,
  type ProjectileTrack,
  type ShotStyle,
} from './projectilePresentation';
import { disposeObjectResources } from './sceneResources';

interface Effect {
  mesh: Mesh | InstancedMesh;
  material: MeshBasicMaterial;
  remaining: number;
  life: number;
  opacity: number;
  ownedGeometry?: boolean;
  travel?: ProjectileTrack;
  projectileWidth?: number;
  batch?: { mesh: InstancedMesh; tracks: ProjectileTrack[]; width: number };
  rise?: number;
  grow?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}

/** Where an impact sits above the ground of the target. */
const IMPACT_HEIGHT = 14;
const BEAM_LIFE = 0.22;
const DEFAULT_PROJECTILE_SPEED = 620;
/** Effects advance before rendering, so a close fast round needs one frame to exist. */
const MIN_PROJECTILE_LIFE = 0.05;
const FLASH_LIFE = 0.3;
const SMOKE_LIFE = 2.6;
const SMOKE_RISE = 13;
/** Enough for a lance in trouble; past that the field is unreadable anyway. */
const MAX_EFFECTS = 320;

const UP = new Vector3(0, 1, 0);
const INSTANCE = new Object3D();
const SMOKE_GEOMETRY = new SphereGeometry(4.5, 7, 6);
const FLASH_GEOMETRY = new SphereGeometry(3.4, 8, 6);

/** Authored style survives the catalogue so range is not the only way to read a weapon. */
export class TracerLayer {
  readonly group = new Group();
  private readonly live: Effect[] = [];

  fire(
    from: Vector3,
    to: Vec2,
    visual: Weapon['visual'],
    projectiles: number,
    velocity: number | null,
    colour: number,
    heightAt: (x: number, y: number) => number,
  ): void {
    if (this.live.length >= MAX_EFFECTS) return;

    const end = new Vector3(to.x, heightAt(to.x, to.y) + IMPACT_HEIGHT, to.y);
    this.muzzleFlash(from, colour, visual.width, visual.style);

    if (visual.style === 'beam') {
      this.beam(from, end, colour, visual.width);
      return;
    }
    if (visual.style === 'pulse') {
      this.pulse(from, end, colour, visual.width);
      return;
    }
    if (visual.style === 'bolt') {
      this.bolt(from, end, colour, visual.width);
      return;
    }
    if (visual.style === 'flame') {
      this.flame(from, end, colour, visual.width);
      return;
    }

    const rounds = roundCount(visual.style, projectiles);
    const tracks: ProjectileTrack[] = [];
    for (let shot = 0; shot < rounds; shot += 1) {
      const spread = rounds === 1 ? 0 : (shot / (rounds - 1) - 0.5) * 18;
      const aim = end.clone();
      aim.x += spread;
      aim.z += spread * (shot % 2 === 0 ? 0.6 : -0.6);
      const arc = visual.arc + (visual.style === 'missile' ? shot * Math.min(4, visual.width) : 0);
      tracks.push(projectileTrack(from, aim, arc, velocity ?? DEFAULT_PROJECTILE_SPEED));
    }
    if (tracks.length === 1 && tracks[0] !== undefined) {
      this.projectile(tracks[0], visual.style, colour, visual.width);
    } else {
      this.projectileSalvo(tracks, visual.style, colour, visual.width);
    }
  }

  private beam(from: Vector3, to: Vector3, colour: number, width: number): void {
    const length = from.distanceTo(to);
    const material = effectMaterial(colour, 0.9);
    const mesh = new Mesh(new CylinderGeometry(width * 0.32, width * 0.32, length, 6), material);
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: BEAM_LIFE,
      life: BEAM_LIFE,
      opacity: 0.9,
      ownedGeometry: true,
    });
  }

  /** Pulse emitters show separated packets without paying one draw call for every dash. */
  private pulse(from: Vector3, to: Vector3, colour: number, width: number): void {
    const distance = from.distanceTo(to);
    const segments = 5;
    const segmentLength = distance * 0.1;
    const material = effectMaterial(colour, 0.92);
    const mesh = new InstancedMesh(
      new CylinderGeometry(width * 0.38, width * 0.38, segmentLength, 6),
      material,
      segments,
    );
    const direction = to.clone().sub(from).normalize();
    for (let index = 0; index < segments; index += 1) {
      INSTANCE.position.copy(from).lerp(to, (index + 0.5) / segments);
      INSTANCE.quaternion.setFromUnitVectors(UP, direction);
      INSTANCE.scale.set(1, 1, 1);
      INSTANCE.updateMatrix();
      mesh.setMatrixAt(index, INSTANCE.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: BEAM_LIFE * 1.35,
      life: BEAM_LIFE * 1.35,
      opacity: 0.92,
      ownedGeometry: true,
    });
  }

  /** A projector's discharge bridges the gap at once, as the resolved hit already has. */
  private bolt(from: Vector3, to: Vector3, colour: number, width: number): void {
    const points = 9;
    const material = effectMaterial(colour, 0.95);
    const mesh = new InstancedMesh(new SphereGeometry(width * 0.44, 7, 5), material, points);
    for (let index = 0; index < points; index += 1) {
      const progress = (index + 1) / points;
      const envelope = Math.sin(progress * Math.PI);
      INSTANCE.position.copy(from).lerp(to, progress);
      INSTANCE.position.y += Math.sin(index * 2.3) * width * 0.7 * envelope;
      INSTANCE.position.z += Math.cos(index * 1.7) * width * 0.45 * envelope;
      INSTANCE.quaternion.identity();
      INSTANCE.scale.set(1, 1, 1);
      INSTANCE.updateMatrix();
      mesh.setMatrixAt(index, INSTANCE.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: BEAM_LIFE * 1.15,
      life: BEAM_LIFE * 1.15,
      opacity: 0.95,
      ownedGeometry: true,
    });
  }

  /** A flamer resolves instantly too; widening packets read as a stream instead of a bolt. */
  private flame(from: Vector3, to: Vector3, colour: number, width: number): void {
    const points = 8;
    const material = effectMaterial(colour, 0.78);
    const mesh = new InstancedMesh(new SphereGeometry(width * 0.24, 7, 5), material, points);
    for (let index = 0; index < points; index += 1) {
      const progress = (index + 1) / points;
      INSTANCE.position.copy(from).lerp(to, progress);
      INSTANCE.position.y += Math.sin(index * 1.9) * width * 0.22 * progress;
      INSTANCE.position.z += Math.cos(index * 1.4) * width * 0.18 * progress;
      INSTANCE.quaternion.identity();
      INSTANCE.scale.set(1 + progress * 1.5, 0.7 + progress, 0.7 + progress);
      INSTANCE.updateMatrix();
      mesh.setMatrixAt(index, INSTANCE.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: FLASH_LIFE,
      life: FLASH_LIFE,
      opacity: 0.78,
      ownedGeometry: true,
    });
  }

  private projectile(
    track: ProjectileTrack,
    style: ShotStyle,
    colour: number,
    width: number,
  ): void {
    const material = effectMaterial(colour, 1);
    const mesh = projectileMesh(style, material);
    placeProjectile(mesh, track, 0, width);
    this.group.add(mesh);

    this.live.push({
      mesh,
      material,
      remaining: Math.max(MIN_PROJECTILE_LIFE, track.duration),
      life: Math.max(MIN_PROJECTILE_LIFE, track.duration),
      opacity: 1,
      travel: track,
      projectileWidth: width,
    });
  }

  private projectileSalvo(
    tracks: ProjectileTrack[],
    style: ShotStyle,
    colour: number,
    width: number,
  ): void {
    if (tracks.length === 0) return;
    const material = effectMaterial(colour, 1);
    const mesh = projectileBatch(style, material, tracks.length);
    let life = MIN_PROJECTILE_LIFE;
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      if (track === undefined) continue;
      placeProjectileInstance(mesh, index, track, 0, width);
      life = Math.max(life, track.duration);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: life,
      life,
      opacity: 1,
      batch: { mesh, tracks, width },
    });
  }

  private muzzleFlash(at: Vector3, colour: number, width: number, style: ShotStyle): void {
    const opacity = style === 'missile' ? 0.72 : 0.85;
    const material = effectMaterial(colour, opacity);
    const mesh = new Mesh(FLASH_GEOMETRY, material);
    mesh.position.copy(at);
    mesh.scale.setScalar(Math.max(0.55, width * 0.34));
    this.group.add(mesh);
    const life = style === 'flame' ? FLASH_LIFE : FLASH_LIFE * 0.5;
    this.live.push({
      mesh,
      material,
      remaining: life,
      life,
      opacity,
      grow: style === 'flame' ? 2.5 : 1.8,
      scaleX: mesh.scale.x,
      scaleY: mesh.scale.y,
      scaleZ: mesh.scale.z,
    });
  }

  /** A hit blooms where the round went in, separate from the firing vocabulary. */
  impact(at: Vec2, ground: number, colour: number): void {
    if (this.live.length >= MAX_EFFECTS) return;
    const material = effectMaterial(colour, 0.9);
    const mesh = new Mesh(FLASH_GEOMETRY, material);
    mesh.position.set(at.x, ground + IMPACT_HEIGHT, at.y);
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: FLASH_LIFE,
      life: FLASH_LIFE,
      opacity: 0.9,
      grow: 2.6,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
  }

  spawnSmoke(at: Vec2, ground: number): void {
    if (this.live.length >= MAX_EFFECTS) return;

    const material = new MeshBasicMaterial({
      color: 0x6a6f74,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const mesh = new Mesh(SMOKE_GEOMETRY, material);
    mesh.position.set(at.x, ground + IMPACT_HEIGHT, at.y);
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: SMOKE_LIFE,
      life: SMOKE_LIFE,
      opacity: 0.5,
      rise: SMOKE_RISE,
      grow: 2.4,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
  }

  update(deltaSeconds: number): void {
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const effect = this.live[index];
      if (effect === undefined) continue;

      effect.remaining -= deltaSeconds;
      if (effect.remaining <= 0) {
        this.group.remove(effect.mesh);
        if (effect.ownedGeometry === true) effect.mesh.geometry.dispose();
        effect.material.dispose();
        this.live.splice(index, 1);
        continue;
      }

      const spent = 1 - effect.remaining / effect.life;
      const elapsed = effect.life - effect.remaining;
      if (effect.batch !== undefined) {
        const { mesh, tracks, width } = effect.batch;
        for (let shot = 0; shot < tracks.length; shot += 1) {
          const track = tracks[shot];
          if (track === undefined) continue;
          placeProjectileInstance(mesh, shot, track, elapsed / track.duration, width);
        }
        mesh.instanceMatrix.needsUpdate = true;
      } else if (effect.travel !== undefined) {
        placeProjectile(
          effect.mesh,
          effect.travel,
          elapsed / effect.travel.duration,
          effect.projectileWidth ?? 2,
        );
      } else if (effect.rise !== undefined) {
        effect.mesh.position.y += effect.rise * deltaSeconds;
      }
      if (effect.grow !== undefined) {
        const growth = 1 + spent * effect.grow;
        effect.mesh.scale.set(
          (effect.scaleX ?? 1) * growth,
          (effect.scaleY ?? 1) * growth,
          (effect.scaleZ ?? 1) * growth,
        );
      }
      effect.material.opacity = effect.opacity * (1 - spent);
    }
  }

  dispose(): void {
    disposeObjectResources(this.group);
    this.group.clear();
    this.live.length = 0;
  }
}

function roundCount(style: ShotStyle, projectiles: number): number {
  if (style === 'missile' || style === 'burst') return Math.max(1, Math.min(6, projectiles));
  if (style === 'tracer' && projectiles > 1) return Math.min(6, projectiles);
  return 1;
}

function effectMaterial(colour: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}
