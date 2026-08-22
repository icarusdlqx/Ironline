import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

interface MovingSlot {
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  floor: number;
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const AT = new Vector3();
const SIZE = new Vector3();
const MATRIX = new Matrix4();
const NO_TURN = new Quaternion();
const SPIN = new Quaternion();
const SPIN_AXIS = new Vector3(1, 0.35, 0.2).normalize();

function slots(capacity: number): MovingSlot[] {
  return Array.from({ length: capacity }, () => ({
    age: 1,
    life: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0,
    floor: 0,
  }));
}

/** Breech discharge is a pair of fixed ring buffers, not a firefight-length spawner. */
export class MechanicalDischargeLayer {
  readonly casings: InstancedMesh;
  readonly vents: InstancedMesh;

  private readonly casingSlots: MovingSlot[];
  private readonly ventSlots: MovingSlot[];
  private nextCasing = 0;
  private nextVent = 0;
  private laidCasings = 0;
  private laidVents = 0;

  constructor(
    private readonly casingCapacity = 56,
    private readonly ventCapacity = 32,
  ) {
    this.casings = new InstancedMesh(
      new CylinderGeometry(0.2, 0.2, 0.85, 6),
      new MeshBasicMaterial({ color: 0xc69b55 }),
      casingCapacity,
    );
    this.vents = new InstancedMesh(
      new SphereGeometry(1, 7, 5),
      new MeshBasicMaterial({ color: 0x778086, transparent: true, opacity: 0.34, depthWrite: false }),
      ventCapacity,
    );
    this.casings.name = 'ejected-casings';
    this.vents.name = 'breech-vents';
    this.casings.frustumCulled = false;
    this.vents.frustumCulled = false;
    this.casings.count = 0;
    this.vents.count = 0;
    this.casingSlots = slots(casingCapacity);
    this.ventSlots = slots(ventCapacity);
    for (let index = 0; index < casingCapacity; index += 1) this.casings.setMatrixAt(index, HIDDEN);
    for (let index = 0; index < ventCapacity; index += 1) this.vents.setMatrixAt(index, HIDDEN);
  }

  fire(
    at: Vector3,
    facing: number,
    heft: number,
    ejectsCasing: boolean,
    ground: number,
  ): void {
    const size = Math.max(0.65, Math.min(2.2, heft));
    const vent = this.ventSlots[this.nextVent];
    if (vent !== undefined) {
      this.write(vent, at, 0.42, size, 0, 2.8, 0);
      this.nextVent = (this.nextVent + 1) % this.ventCapacity;
      this.laidVents = Math.min(this.ventCapacity, this.laidVents + 1);
      this.vents.count = this.laidVents;
    }

    if (!ejectsCasing) return;
    const casing = this.casingSlots[this.nextCasing];
    if (casing === undefined) return;
    const side = this.nextCasing % 2 === 0 ? 1 : -1;
    const lateral = (4.2 + (this.nextCasing % 5) * 0.35) * side;
    this.write(
      casing,
      at,
      0.82,
      size,
      -Math.sin(facing) * lateral - Math.cos(facing) * 1.2,
      5.5 + (this.nextCasing % 3) * 0.7,
      Math.cos(facing) * lateral - Math.sin(facing) * 1.2,
    );
    casing.floor = ground + 0.2;
    this.nextCasing = (this.nextCasing + 1) % this.casingCapacity;
    this.laidCasings = Math.min(this.casingCapacity, this.laidCasings + 1);
    this.casings.count = this.laidCasings;
  }

  update(deltaSeconds: number): void {
    const dt = Math.max(0, deltaSeconds);
    for (let index = 0; index < this.laidVents; index += 1) {
      const slot = this.ventSlots[index];
      if (slot === undefined) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        this.vents.setMatrixAt(index, HIDDEN);
        continue;
      }
      const progress = slot.age / slot.life;
      AT.set(slot.x + slot.vx * slot.age, slot.y + slot.vy * slot.age, slot.z + slot.vz * slot.age);
      SIZE.setScalar(slot.size * (0.55 + progress * 1.8));
      this.vents.setMatrixAt(index, MATRIX.compose(AT, NO_TURN, SIZE));
    }

    for (let index = 0; index < this.laidCasings; index += 1) {
      const slot = this.casingSlots[index];
      if (slot === undefined) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        this.casings.setMatrixAt(index, HIDDEN);
        continue;
      }
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt;
      slot.z += slot.vz * dt;
      slot.vy -= 22 * dt;
      if (slot.y < slot.floor) {
        slot.y = slot.floor;
        slot.vy = Math.abs(slot.vy) * 0.22;
        slot.vx *= 0.65;
        slot.vz *= 0.65;
      }
      AT.set(slot.x, slot.y, slot.z);
      SIZE.setScalar(slot.size);
      SPIN.setFromAxisAngle(SPIN_AXIS, slot.age * 19 + index);
      this.casings.setMatrixAt(index, MATRIX.compose(AT, SPIN, SIZE));
    }
    this.casings.instanceMatrix.needsUpdate = true;
    this.vents.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.casings.geometry.dispose();
    this.vents.geometry.dispose();
    if (Array.isArray(this.casings.material)) {
      this.casings.material.forEach((material) => material.dispose());
    } else {
      this.casings.material.dispose();
    }
    if (Array.isArray(this.vents.material)) {
      this.vents.material.forEach((material) => material.dispose());
    } else {
      this.vents.material.dispose();
    }
  }

  private write(
    slot: MovingSlot,
    at: Vector3,
    life: number,
    size: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    slot.age = 0;
    slot.life = life;
    slot.x = at.x;
    slot.y = at.y;
    slot.z = at.z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.size = size;
    slot.floor = at.y;
  }
}
