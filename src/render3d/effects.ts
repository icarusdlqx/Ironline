import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Vec2 } from '../sim/types';

/** Parked off-screen by being scaled to nothing, the way the prop layer hides. */
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const NO_TURN = new Quaternion();
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

const AT = new Vector3();
const SIZE = new Vector3();
const MATRIX = new Matrix4();
const TINT = new Color();

/**
 * Jet exhaust, drawn from the jump state rather than from an event. A jump is
 * an arc with a beginning and an end and nothing in between, so a plume spawned
 * on `jump_started` would have to guess how long to burn; reading `entity.jump`
 * every frame means the flame simply matches the arc.
 *
 * The plumes live here in world space and are never parented to a mech model:
 * a model is rebuilt and disposed whenever the mech loses a location, and
 * disposal traverses and destroys every material it finds under the root.
 */
export class JetLayer {
  readonly group = new Group();

  private readonly slots: { mesh: Mesh; material: MeshBasicMaterial }[] = [];
  private readonly used = new Set<number>();
  /** Wobble per slot, so two jets on one mech are not the same flame twice. */
  private readonly phase: number[] = [];

  constructor(private readonly capacity = 24) {
    this.group.name = 'jets';
    const geometry = new ConeGeometry(1, 1, 7, 1, true);
    // The cone is modelled pointing up and then flipped, so scaling its height
    // grows the flame downward from the nozzle rather than through the shin.
    geometry.translate(0, -0.5, 0);

    for (let index = 0; index < capacity; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xffd28a,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.slots.push({ mesh, material });
      this.phase.push(index * 1.37);
    }
  }

  /** Call once per frame before any plume(). */
  begin(): void {
    this.used.clear();
  }

  /**
   * Lights one nozzle. `throttle` runs 0 to 1: hard on the pads to get off the
   * ground, cut over the top of the arc, relit to cushion the landing.
   */
  plume(key: number, at: Vector3, throttle: number, elapsed: number): void {
    const index = key % this.capacity;
    const slot = this.slots[index];
    if (slot === undefined || throttle <= 0.02) return;
    this.used.add(index);

    const flicker = 0.85 + 0.15 * Math.sin(elapsed * 41 + (this.phase[index] ?? 0));
    slot.mesh.visible = true;
    slot.mesh.position.copy(at);
    slot.mesh.scale.set(2.4 + 1.6 * throttle, (9 + 30 * throttle) * flicker, 2.4 + 1.6 * throttle);
    slot.material.opacity = 0.62 * throttle;
    // White-hot at full throttle, guttering orange as it comes off the pads.
    slot.material.color.setHex(throttle > 0.6 ? 0xfff2c8 : 0xff9a3c);
  }

  /** Puts out every nozzle nobody lit this frame. */
  commit(): void {
    for (let index = 0; index < this.slots.length; index += 1) {
      if (this.used.has(index)) continue;
      const slot = this.slots[index];
      if (slot !== undefined) slot.mesh.visible = false;
    }
  }
}

const PUFFS = 9;
const CYCLE = 5.5;
const RISE = 95;

interface Column {
  x: number;
  z: number;
  ground: number;
  base: number;
}

/**
 * The smoke column over a wreck. It burns for the rest of the battle, so it
 * cannot be a spawner: nine instances cycle forever, each rising, growing and
 * wrapping back to the base, which makes the cost of a field of wrecks flat in
 * battle length rather than growing with it.
 *
 * The puffs do not fade to transparent. They fade to the colour of the
 * distance, which is what smoke actually does and which sidesteps sorting a
 * hundred overlapping translucent billboards.
 */
export class SmokeLayer {
  readonly mesh: InstancedMesh;

  private readonly columns: Column[] = [];
  private readonly age: number[] = [];
  private readonly drift: Vec2;
  private readonly far: Color;

  constructor(
    fogColour: Color,
    /** Which way the air is moving, so every column leans the same way. */
    drift: Vec2 = { x: 26, y: -14 },
    private readonly capacity = 16,
  ) {
    this.drift = drift;
    this.far = fogColour.clone();

    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new InstancedMesh(new SphereGeometry(1, 7, 6), material, capacity * PUFFS);
    this.mesh.name = 'wreck-smoke';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let slot = 0; slot < capacity * PUFFS; slot += 1) {
      this.mesh.setMatrixAt(slot, HIDDEN);
      this.age.push(0);
    }
  }

  /** Opens a column over a wreck. Silently ignored once the budget is spent. */
  start(at: Vec2, ground: number): void {
    if (this.columns.length >= this.capacity) return;
    const base = this.columns.length * PUFFS;
    this.columns.push({ x: at.x, z: at.y, ground, base });

    // Staggered, or all nine puffs of a new column leave the ground together
    // and it reads as a pulse rather than as something burning.
    for (let puff = 0; puff < PUFFS; puff += 1) {
      this.age[base + puff] = (-puff * CYCLE) / PUFFS;
    }
    this.mesh.count = this.columns.length * PUFFS;
  }

  update(deltaSeconds: number): void {
    if (this.columns.length === 0) return;

    for (const column of this.columns) {
      for (let puff = 0; puff < PUFFS; puff += 1) {
        const slot = column.base + puff;
        let age = (this.age[slot] ?? 0) + deltaSeconds;
        if (age >= CYCLE) age -= CYCLE;
        this.age[slot] = age;

        if (age < 0) {
          this.mesh.setMatrixAt(slot, HIDDEN);
          continue;
        }

        // Drift accelerates: a puff leaving the hull is still in its own heat
        // and only picks up the wind once it is clear of it.
        const t = age / CYCLE;
        AT.set(
          column.x + this.drift.x * t * t,
          column.ground + 6 + RISE * t,
          column.z + this.drift.y * t * t,
        );
        SIZE.setScalar(3.4 + 15 * t);
        this.mesh.setMatrixAt(slot, MATRIX.compose(AT, NO_TURN, SIZE));
        this.mesh.setColorAt(slot, TINT.setHex(0x4a4f54).lerp(this.far, t * t));
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * Where the shooting has been. Scars accumulate and never expire, so they are
 * one instanced disc over a ring buffer: past the budget the oldest mark is
 * reused, which keeps the ground telling a story without the cost growing with
 * the length of the battle.
 */
export class ScarLayer {
  readonly mesh: InstancedMesh;

  private next = 0;
  private laid = 0;

  constructor(private readonly capacity = 220) {
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false });
    this.mesh = new InstancedMesh(new CircleGeometry(1, 10), material, capacity);
    this.mesh.name = 'scars';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Lifted a hand's breadth off the ground: coplanar with the terrain and the
    // depth buffer cannot decide which is in front, which reads as flicker.
    this.mesh.renderOrder = 1;
    for (let slot = 0; slot < capacity; slot += 1) this.mesh.setMatrixAt(slot, HIDDEN);
  }

  /**
   * Burns a mark into the ground. `heat` runs 0 to 1 and picks the colour:
   * a laser leaves a black scorch, a shell leaves turned earth.
   */
  mark(at: Vec2, ground: number, radius: number, heat: number): void {
    const slot = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.laid = Math.min(this.capacity, this.laid + 1);
    this.mesh.count = this.laid;

    AT.set(at.x, ground + 0.35, at.y);
    SIZE.set(radius, radius, radius);
    this.mesh.setMatrixAt(slot, MATRIX.compose(AT, FLAT, SIZE));
    this.mesh.setColorAt(slot, TINT.setHex(0x140f0c).lerp(TINT.clone().setHex(0x4a3524), 1 - heat));

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }
}
