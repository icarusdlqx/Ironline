import {
  AdditiveBlending,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  type Vector3,
} from 'three';
import type { Vec2 } from '../sim/types';
import {
  baseShotSlot,
  safeShotDelta,
  ShotPoolCore,
  type ShotPoolSnapshot,
  type ShotSlot,
} from './shotPoolCore';

export type ShotBurstKind = 'hit' | 'miss' | 'critical' | 'ammo' | 'terminal';
type InternalBurstKind = ShotBurstKind | 'muzzle';

interface BurstProfile {
  life: number;
  particles: number;
  size: number;
  grow: number;
  rise: number;
  spread: number;
  opacity: number;
}

interface BurstSlot extends ShotSlot {
  x: number;
  y: number;
  z: number;
  scale: number;
  size: number;
  grow: number;
  rise: number;
  spread: number;
}

const PROFILES: Readonly<Record<InternalBurstKind, BurstProfile>> = Object.freeze({
  muzzle: { life: 0.15, particles: 1, size: 1, grow: 1.8, rise: 0, spread: 0, opacity: 0.85 },
  hit: { life: 0.3, particles: 3, size: 0.9, grow: 2.6, rise: 4, spread: 2.4, opacity: 0.9 },
  miss: { life: 0.4, particles: 3, size: 0.65, grow: 1.8, rise: 7, spread: 3.2, opacity: 0.7 },
  critical: { life: 0.62, particles: 6, size: 1.05, grow: 2.8, rise: 9, spread: 5.2, opacity: 1 },
  ammo: { life: 0.55, particles: 5, size: 0.8, grow: 2.5, rise: 8, spread: 5, opacity: 0.95 },
  terminal: { life: 1.1, particles: 8, size: 1.35, grow: 3.6, rise: 13, spread: 10, opacity: 1 },
});

const INSTANCE = new Object3D();

/** One compact particle batch covers impacts and the two explosion scales. */
export class ShotBurstPool {
  readonly mesh: InstancedMesh;
  private readonly core: ShotPoolCore<BurstSlot>;

  constructor(capacity: number, instancesPerSlot = 8) {
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(
      new OctahedronGeometry(1, 0),
      material,
      capacity * instancesPerSlot,
    );
    this.mesh.name = 'shot-burst';
    this.core = new ShotPoolCore(this.mesh, capacity, instancesPerSlot, (index) => ({
      ...baseShotSlot(index * instancesPerSlot),
      x: 0,
      y: 0,
      z: 0,
      scale: 1,
      size: 1,
      grow: 1,
      rise: 0,
      spread: 0,
    }));
  }

  spawn(
    at: Vec2,
    ground: number,
    kind: ShotBurstKind,
    colour: number,
    scale: number,
    lifeScale: number,
    detailScale: number,
  ): void {
    this.spawnAt(
      at.x,
      ground + 14,
      at.y,
      kind,
      colour,
      scale,
      lifeScale,
      detailScale,
    );
  }

  muzzle(
    at: Vector3,
    colour: number,
    scale: number,
    lifeScale: number,
    detailScale: number,
  ): void {
    this.spawnAt(at.x, at.y, at.z, 'muzzle', colour, scale, lifeScale, detailScale);
  }

  update(deltaSeconds: number): void {
    const delta = safeShotDelta(deltaSeconds);
    for (const slot of this.core.slots) {
      if (!slot.active) continue;
      slot.remaining -= delta;
      if (slot.remaining <= 0) {
        this.core.expire(slot);
        continue;
      }
      const spent = 1 - slot.remaining / slot.life;
      this.writeMatrices(slot, spent);
      for (let index = 0; index < slot.count; index += 1) {
        this.core.setColour(slot, index, 1 - spent);
      }
    }
    this.core.commit();
  }

  snapshot(): ShotPoolSnapshot {
    return this.core.snapshot();
  }

  clear(): void {
    this.core.clear();
  }

  private spawnAt(
    x: number,
    y: number,
    z: number,
    kind: InternalBurstKind,
    colour: number,
    scale: number,
    lifeScale: number,
    detailScale: number,
  ): void {
    const profile = PROFILES[kind];
    const slot = this.core.acquire();
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.scale = Math.max(0.1, scale);
    slot.size = profile.size;
    slot.grow = profile.grow;
    slot.rise = profile.rise;
    slot.spread = profile.spread;
    this.core.configure(
      slot,
      profile.life * lifeScale,
      Math.max(1, Math.ceil(profile.particles * detailScale)),
      colour,
      profile.opacity,
    );
    this.writeMatrices(slot, 0);
    for (let index = 0; index < slot.count; index += 1) this.core.setColour(slot, index, 1);
    this.core.commit();
  }

  private writeMatrices(slot: BurstSlot, spent: number): void {
    for (let index = 0; index < slot.count; index += 1) {
      const angle = index * 2.399963;
      const reach = slot.spread * slot.scale * (0.35 + index / slot.count * 0.65) * spent;
      INSTANCE.position.set(
        slot.x + Math.cos(angle) * reach,
        slot.y + slot.rise * slot.life * spent + Math.sin(index * 1.7) * reach * 0.28,
        slot.z + Math.sin(angle) * reach,
      );
      INSTANCE.quaternion.identity();
      const size = slot.scale * slot.size * (1 + spent * slot.grow) * (1 - index * 0.035);
      INSTANCE.scale.setScalar(size);
      INSTANCE.updateMatrix();
      this.core.setMatrix(slot, index, INSTANCE.matrix);
    }
  }
}
