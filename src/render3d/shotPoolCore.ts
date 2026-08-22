import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
} from 'three';

export interface ShotSlot {
  active: boolean;
  remaining: number;
  life: number;
  colour: number;
  opacity: number;
  count: number;
  start: number;
}

export interface ShotPoolSnapshot {
  readonly capacity: number;
  readonly active: number;
  readonly physicalCapacity: number;
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** The ring may overwrite an old read, but it never grows during a firefight. */
export class ShotPoolCore<T extends ShotSlot> {
  readonly slots: readonly T[];
  private cursor = 0;
  private activeSlots = 0;

  constructor(
    readonly mesh: InstancedMesh,
    readonly capacity: number,
    readonly instancesPerSlot: number,
    makeSlot: (index: number) => T,
  ) {
    this.slots = Array.from({ length: capacity }, (_, index) => makeSlot(index));
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(mesh.count * 3),
      3,
    );
    for (let index = 0; index < mesh.count; index += 1) {
      mesh.setMatrixAt(index, HIDDEN);
      mesh.instanceColor.setXYZ(index, 0, 0, 0);
    }
    this.commit();
  }

  acquire(): T {
    const slot = this.slots[this.cursor];
    if (slot === undefined) throw new Error('shot pool has no slots');
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!slot.active) this.activeSlots += 1;
    this.hide(slot);
    slot.active = true;
    return slot;
  }

  configure(slot: T, life: number, count: number, colour: number, opacity: number): void {
    slot.life = Math.max(0.001, life);
    slot.remaining = slot.life;
    slot.count = Math.max(1, Math.min(this.instancesPerSlot, Math.floor(count)));
    slot.colour = colour;
    slot.opacity = opacity;
  }

  expire(slot: T): void {
    if (!slot.active) return;
    slot.active = false;
    slot.remaining = 0;
    this.activeSlots -= 1;
    this.hide(slot);
  }

  setMatrix(slot: T, offset: number, matrix: Matrix4): void {
    if (offset < 0 || offset >= slot.count) return;
    this.mesh.setMatrixAt(slot.start + offset, matrix);
  }

  setColour(slot: T, offset: number, intensity: number): void {
    if (offset < 0 || offset >= slot.count) return;
    const strength = Math.max(0, intensity) * slot.opacity;
    this.mesh.instanceColor?.setXYZ(
      slot.start + offset,
      ((slot.colour >> 16) & 0xff) / 255 * strength,
      ((slot.colour >> 8) & 0xff) / 255 * strength,
      (slot.colour & 0xff) / 255 * strength,
    );
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.remaining = 0;
      this.hide(slot);
    }
    this.activeSlots = 0;
    this.cursor = 0;
    this.commit();
  }

  snapshot(): ShotPoolSnapshot {
    return {
      capacity: this.capacity,
      active: this.activeSlots,
      physicalCapacity: this.mesh.count,
    };
  }

  private hide(slot: T): void {
    for (let index = 0; index < this.instancesPerSlot; index += 1) {
      this.mesh.setMatrixAt(slot.start + index, HIDDEN);
      this.mesh.instanceColor?.setXYZ(slot.start + index, 0, 0, 0);
    }
  }
}

export function baseShotSlot(start: number): ShotSlot {
  return {
    active: false,
    remaining: 0,
    life: 0.001,
    colour: 0xffffff,
    opacity: 1,
    count: 1,
    start,
  };
}

export function safeShotDelta(deltaSeconds: number): number {
  return Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
}
