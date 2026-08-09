import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Vec2 } from '../sim/types';

interface Tracer {
  line: Line;
  material: LineBasicMaterial;
  remaining: number;
  life: number;
}

interface Smoke {
  mesh: Mesh;
  material: MeshBasicMaterial;
  remaining: number;
  life: number;
}

const SMOKE_GEOMETRY = new SphereGeometry(4.5, 7, 6);
const SMOKE_LIFE = 2.6;
const SMOKE_RISE = 13;
/** Enough for a lance in trouble; past that the field is unreadable anyway. */
const MAX_SMOKE = 90;

/** How long a shot stays on screen, in seconds. */
const LIFE = 0.16;

/** Where a weapon sits above the ground it is standing on. */
const MUZZLE = 14;

/**
 * Weapon fire, drawn as a line from muzzle to target that fades out. The 2D
 * renderer distinguished beams from shells from missile arcs; this keeps the
 * weapon's own colour and leaves the shapes for a later pass.
 */
export class TracerLayer {
  readonly group = new Group();
  private readonly live: Tracer[] = [];
  private readonly smoke: Smoke[] = [];

  fire(from: Vec2, to: Vec2, colour: number, heightAt: (x: number, y: number) => number): void {
    const material = new LineBasicMaterial({ color: colour, transparent: true, opacity: 1 });
    const line = new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(from.x, heightAt(from.x, from.y) + MUZZLE, from.y),
        new Vector3(to.x, heightAt(to.x, to.y) + MUZZLE, to.y),
      ]),
      material,
    );
    this.group.add(line);
    this.live.push({ line, material, remaining: LIFE, life: LIFE });
  }

  /** A puff off a damaged mech, which rises, spreads and fades. */
  spawnSmoke(at: Vec2, ground: number): void {
    if (this.smoke.length >= MAX_SMOKE) return;

    const material = new MeshBasicMaterial({
      color: 0x6a6f74,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const puff = new Mesh(SMOKE_GEOMETRY, material);
    puff.position.set(at.x, ground + MUZZLE, at.y);
    this.group.add(puff);
    this.smoke.push({ mesh: puff, material, remaining: SMOKE_LIFE, life: SMOKE_LIFE });
  }

  update(deltaSeconds: number): void {
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const tracer = this.live[index];
      if (tracer === undefined) continue;

      tracer.remaining -= deltaSeconds;
      if (tracer.remaining <= 0) {
        this.group.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.material.dispose();
        this.live.splice(index, 1);
        continue;
      }
      tracer.material.opacity = tracer.remaining / tracer.life;
    }

    for (let index = this.smoke.length - 1; index >= 0; index -= 1) {
      const puff = this.smoke[index];
      if (puff === undefined) continue;

      puff.remaining -= deltaSeconds;
      if (puff.remaining <= 0) {
        this.group.remove(puff.mesh);
        puff.material.dispose();
        this.smoke.splice(index, 1);
        continue;
      }

      const spent = 1 - puff.remaining / puff.life;
      puff.mesh.position.y += SMOKE_RISE * deltaSeconds;
      puff.mesh.scale.setScalar(1 + spent * 2.4);
      puff.material.opacity = 0.5 * (1 - spent);
    }
  }
}
