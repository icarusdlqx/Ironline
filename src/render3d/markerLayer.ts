import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { teamColour, UI } from '../render/palette';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../sim/types';

export interface MarkerViewState {
  selection: ReadonlySet<EntityId>;
  orderMode: 'move' | 'run' | 'attack' | 'attack_move' | 'called_shot' | 'jump' | null;
  supportRadius: { at: Vec2; radius: number } | null;
  supportRun: { at: Vec2; heading: number; length: number; width: number } | null;
}

const REACHES: number[] = [];
const PATH_POINTS = 128;

/** Pooled battlefield annotations, kept out of the scene's orchestration. */
export class MarkerLayer {
  readonly group = new Group();

  private readonly ringGeometries = new Map<number, RingGeometry>();
  private readonly markerMaterials = new Map<string, MeshBasicMaterial>();
  private readonly ringPool: Mesh[] = [];
  private ringsUsed = 0;
  private readonly pathPool: Line[] = [];
  private pathsUsed = 0;
  private readonly pathMaterial = new LineBasicMaterial({
    color: UI.moveMarker,
    transparent: true,
    opacity: 0.7,
  });
  private readonly supportLaneMaterial = new LineBasicMaterial({
    color: UI.attackMarker,
    transparent: true,
    opacity: 0.9,
  });
  private readonly supportLane: Line;

  constructor(
    private readonly heightAt: (x: number, y: number) => number,
    private readonly positionOf: (id: EntityId) => Vec2 | null,
  ) {
    this.group.name = 'markers';
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(5 * 3), 3));
    this.supportLane = new Line(geometry, this.supportLaneMaterial);
    this.supportLane.frustumCulled = false;
    this.supportLane.visible = false;
    this.group.add(this.supportLane);
  }

  dispose(): void {
    for (const geometry of this.ringGeometries.values()) geometry.dispose();
    for (const material of this.markerMaterials.values()) material.dispose();
    for (const line of this.pathPool) line.geometry.dispose();
    this.pathMaterial.dispose();
    this.supportLane.geometry.dispose();
    this.supportLaneMaterial.dispose();
  }

  draw(world: World, view: MarkerViewState): void {
    this.ringsUsed = 0;
    this.pathsUsed = 0;

    for (const zone of world.zones) {
      const colour = zone.owner === null ? UI.ghost : teamColour(zone.owner);
      this.groundRing(zone, zone.radius, colour, 0.55);
    }

    for (const reveal of world.reveals) {
      if (world.playerTeam !== null && reveal.team !== world.playerTeam) continue;
      this.groundRing({ x: reveal.x, y: reveal.y }, reveal.radius, UI.selection, 0.3);
    }

    for (const pending of world.support.pending) {
      this.groundRing(pending.target, 26, UI.attackMarker, 0.85);
    }

    if (view.supportRadius !== null) {
      this.groundRing(view.supportRadius.at, view.supportRadius.radius, UI.selection, 0.7);
    }
    this.supportLane.visible = false;
    if (view.supportRun !== null) this.drawSupportLane(view.supportRun);

    for (const entity of world.entities) {
      if (!view.selection.has(entity.id) || !isOperational(entity)) continue;

      if (view.orderMode === 'jump' && entity.jumpRange > 0 && entity.jumpCooldown <= 0) {
        this.groundRing(entity.pos, entity.jumpRange, UI.moveMarker, 0.5);
      }
      this.groundRing(entity.pos, entity.sensorRange, UI.selection, 0.14);

      if (
        view.orderMode === 'attack' ||
        view.orderMode === 'attack_move' ||
        view.orderMode === 'called_shot'
      ) {
        this.weaponReaches(world, entity);
      }

      if (entity.path.length > 0) this.pathLine(entity);
    }

    for (let index = this.ringsUsed; index < this.ringPool.length; index += 1) {
      const ring = this.ringPool[index];
      if (ring !== undefined) ring.visible = false;
    }
    for (let index = this.pathsUsed; index < this.pathPool.length; index += 1) {
      const line = this.pathPool[index];
      if (line !== undefined) line.visible = false;
    }
  }

  private weaponReaches(world: World, entity: MechEntity): void {
    REACHES.length = 0;
    for (const mount of entity.weapons) {
      if (mount.destroyed) continue;
      const weapon = world.catalog.weapons.get(mount.weaponId);
      if (weapon === undefined) continue;
      const reach = Math.round(weapon.range.long);
      if (!REACHES.includes(reach)) REACHES.push(reach);
    }
    REACHES.sort((a, b) => a - b);
    for (let index = 0; index < REACHES.length && index < 3; index += 1) {
      this.groundRing(entity.pos, REACHES[index] ?? 0, UI.attackMarker, 0.35);
    }
  }

  private groundRing(at: Vec2, radius: number, colour: number, opacity: number): void {
    let ring = this.ringPool[this.ringsUsed];
    if (ring === undefined) {
      ring = new Mesh();
      ring.rotation.x = -Math.PI / 2;
      this.group.add(ring);
      this.ringPool.push(ring);
    }
    this.ringsUsed += 1;

    ring.geometry = this.ringGeometry(radius);
    ring.material = this.markerMaterial(colour, opacity);
    ring.position.set(at.x, this.heightAt(at.x, at.y) + 1, at.y);
    ring.visible = true;
  }

  private drawSupportLane(run: { at: Vec2; heading: number; length: number; width: number }): void {
    const alongX = Math.cos(run.heading) * (run.length / 2);
    const alongY = Math.sin(run.heading) * (run.length / 2);
    const acrossX = -Math.sin(run.heading) * (run.width / 2);
    const acrossY = Math.cos(run.heading) * (run.width / 2);
    const positions = this.supportLane.geometry.getAttribute('position') as BufferAttribute;
    const nearLeftX = run.at.x - alongX - acrossX;
    const nearLeftY = run.at.y - alongY - acrossY;
    this.setSupportPoint(positions, 0, nearLeftX, nearLeftY);
    this.setSupportPoint(positions, 1, run.at.x + alongX - acrossX, run.at.y + alongY - acrossY);
    this.setSupportPoint(positions, 2, run.at.x + alongX + acrossX, run.at.y + alongY + acrossY);
    this.setSupportPoint(positions, 3, run.at.x - alongX + acrossX, run.at.y - alongY + acrossY);
    this.setSupportPoint(positions, 4, nearLeftX, nearLeftY);
    positions.needsUpdate = true;
    this.supportLane.visible = true;
  }

  private setSupportPoint(
    positions: BufferAttribute,
    index: number,
    x: number,
    y: number,
  ): void {
    positions.setXYZ(index, x, this.heightAt(x, y) + 1.4, y);
  }

  private ringGeometry(radius: number): RingGeometry {
    const existing = this.ringGeometries.get(radius);
    if (existing !== undefined) return existing;
    const fresh = new RingGeometry(Math.max(1, radius - 1.6), radius, 40);
    this.ringGeometries.set(radius, fresh);
    return fresh;
  }

  private markerMaterial(colour: number, opacity: number): MeshBasicMaterial {
    const key = `${colour}:${opacity}`;
    const existing = this.markerMaterials.get(key);
    if (existing !== undefined) return existing;
    const fresh = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.markerMaterials.set(key, fresh);
    return fresh;
  }

  private pathLine(entity: MechEntity): void {
    let line = this.pathPool[this.pathsUsed];
    if (line === undefined) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(PATH_POINTS * 3), 3));
      line = new Line(geometry, this.pathMaterial);
      line.frustumCulled = false;
      this.group.add(line);
      this.pathPool.push(line);
    }
    this.pathsUsed += 1;

    const positions = line.geometry.getAttribute('position') as BufferAttribute;
    const at = this.positionOf(entity.id) ?? entity.pos;
    positions.setXYZ(0, at.x, this.heightAt(at.x, at.y) + 1.5, at.y);
    let count = 1;
    for (let index = entity.pathIndex; index < entity.path.length && count < PATH_POINTS; index += 1) {
      const point = entity.path[index];
      if (point === undefined) break;
      positions.setXYZ(count, point.x, this.heightAt(point.x, point.y) + 1.5, point.y);
      count += 1;
    }
    positions.needsUpdate = true;
    line.geometry.setDrawRange(0, count);
    line.visible = true;
  }
}
