import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { WeaponType } from '../schema/weapon';
import type { Vec2 } from '../sim/types';

interface Effect {
  mesh: Mesh;
  material: MeshBasicMaterial;
  remaining: number;
  life: number;
  /** Set for a shell or a missile: where it is going and how it fades. */
  travel?: { from: Vector3; to: Vector3; arc: number };
  rise?: number;
  grow?: number;
}

/** Where a weapon sits above the ground it is standing on. */
const MUZZLE = 14;

const BEAM_LIFE = 0.22;
const SHELL_SPEED = 620;
const MISSILE_SPEED = 340;
const FLASH_LIFE = 0.3;
const SMOKE_LIFE = 2.6;
const SMOKE_RISE = 13;
/** Enough for a lance in trouble; past that the field is unreadable anyway. */
const MAX_EFFECTS = 320;

const SMOKE_GEOMETRY = new SphereGeometry(4.5, 7, 6);
const FLASH_GEOMETRY = new SphereGeometry(3.4, 8, 6);
const SHELL_GEOMETRY = new BoxGeometry(4.2, 1.1, 1.1);
const MISSILE_GEOMETRY = new BoxGeometry(5, 1.4, 1.4);

/**
 * Weapon fire, drawn as what it actually is. A laser is a beam that appears
 * whole and fades; an autocannon throws a tracer that takes time to arrive; a
 * launcher puts several rounds in the air on slightly different paths. The
 * point is that a player can tell what is being shot at them without reading
 * the log.
 */
export class TracerLayer {
  readonly group = new Group();
  private readonly live: Effect[] = [];

  fire(
    from: Vec2,
    to: Vec2,
    type: WeaponType,
    projectiles: number,
    colour: number,
    heightAt: (x: number, y: number) => number,
  ): void {
    if (this.live.length >= MAX_EFFECTS) return;

    const start = new Vector3(from.x, heightAt(from.x, from.y) + MUZZLE, from.y);
    const end = new Vector3(to.x, heightAt(to.x, to.y) + MUZZLE, to.y);

    this.muzzleFlash(start, colour);

    if (type === 'energy') {
      this.beam(start, end, colour);
      return;
    }

    // A rack in the air is several rounds, not one; a cannon is a single shell.
    const rounds = type === 'missile' ? Math.max(1, Math.min(6, projectiles)) : 1;
    for (let shot = 0; shot < rounds; shot += 1) {
      const spread = rounds === 1 ? 0 : (shot / (rounds - 1) - 0.5) * 18;
      const aim = end.clone();
      aim.x += spread;
      aim.z += spread * 0.6;
      this.projectile(start, aim, type, colour, shot);
    }
  }

  /** A laser: the whole beam at once, gone almost as fast. */
  private beam(from: Vector3, to: Vector3, colour: number): void {
    const length = from.distanceTo(to);
    const material = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(new CylinderGeometry(1.1, 1.1, length, 6), material);
    mesh.position.copy(from).lerp(to, 0.5);
    // Cylinders run up their own Y; point this one down the shot.
    mesh.quaternion.setFromUnitVectors(
      new Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    this.group.add(mesh);
    this.live.push({ mesh, material, remaining: BEAM_LIFE, life: BEAM_LIFE });
  }

  /** A shell or a missile: a body that crosses the gap and then goes off. */
  private projectile(
    from: Vector3,
    to: Vector3,
    type: WeaponType,
    colour: number,
    index: number,
  ): void {
    const speed = type === 'missile' ? MISSILE_SPEED : SHELL_SPEED;
    const life = Math.max(0.08, from.distanceTo(to) / speed);
    const material = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(type === 'missile' ? MISSILE_GEOMETRY : SHELL_GEOMETRY, material);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(
      new Vector3(1, 0, 0),
      to.clone().sub(from).normalize(),
    );
    this.group.add(mesh);

    this.live.push({
      mesh,
      material,
      remaining: life,
      life,
      // Missiles loft; shells go flat. Staggering the arcs keeps a salvo from
      // looking like one fat round.
      travel: { from: from.clone(), to: to.clone(), arc: type === 'missile' ? 26 + index * 4 : 0 },
    });
  }

  private muzzleFlash(at: Vector3, colour: number): void {
    const material = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(FLASH_GEOMETRY, material);
    mesh.position.copy(at);
    this.group.add(mesh);
    this.live.push({ mesh, material, remaining: FLASH_LIFE * 0.5, life: FLASH_LIFE * 0.5, grow: 1.8 });
  }

  /** A hit: a bright bloom where the round went in. */
  impact(at: Vec2, ground: number, colour: number): void {
    if (this.live.length >= MAX_EFFECTS) return;
    const material = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(FLASH_GEOMETRY, material);
    mesh.position.set(at.x, ground + MUZZLE, at.y);
    this.group.add(mesh);
    this.live.push({ mesh, material, remaining: FLASH_LIFE, life: FLASH_LIFE, grow: 2.6 });
  }

  /** A puff off a damaged mech, which rises, spreads and fades. */
  spawnSmoke(at: Vec2, ground: number): void {
    if (this.live.length >= MAX_EFFECTS) return;

    const material = new MeshBasicMaterial({
      color: 0x6a6f74,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const mesh = new Mesh(SMOKE_GEOMETRY, material);
    mesh.position.set(at.x, ground + MUZZLE, at.y);
    this.group.add(mesh);
    this.live.push({
      mesh,
      material,
      remaining: SMOKE_LIFE,
      life: SMOKE_LIFE,
      rise: SMOKE_RISE,
      grow: 2.4,
    });
  }

  update(deltaSeconds: number): void {
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const effect = this.live[index];
      if (effect === undefined) continue;

      effect.remaining -= deltaSeconds;
      if (effect.remaining <= 0) {
        this.group.remove(effect.mesh);
        // Beams build their own geometry; everything else shares a template.
        if (effect.mesh.geometry.type === 'CylinderGeometry') effect.mesh.geometry.dispose();
        effect.material.dispose();
        this.live.splice(index, 1);
        continue;
      }

      const spent = 1 - effect.remaining / effect.life;

      if (effect.travel !== undefined) {
        const { from, to, arc } = effect.travel;
        effect.mesh.position.lerpVectors(from, to, spent);
        // A lobbed round rides over the top of its own path.
        effect.mesh.position.y += Math.sin(spent * Math.PI) * arc;
        effect.material.opacity = 1;
        continue;
      }

      if (effect.rise !== undefined) effect.mesh.position.y += effect.rise * deltaSeconds;
      if (effect.grow !== undefined) effect.mesh.scale.setScalar(1 + spent * effect.grow);
      effect.material.opacity = (effect.material.opacity > 0.5 ? 0.9 : 0.5) * (1 - spent);
    }
  }
}
