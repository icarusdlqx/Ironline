import { Mesh, MeshBasicMaterial, RingGeometry, Scene, Vector3 } from 'three';
import { LOCATIONS } from '../schema/common';
import { teamColour, UI } from '../render/palette';
import { DEFAULT_SILHOUETTE, radiusFor } from '../render/shape';
import { angleDifference, normaliseAngle } from '../sim/math';
import { jumpHeight } from '../sim/movement';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../sim/types';
import type { Weapon } from '../schema/weapon';
import { buildMechModel, disposeModel, type MechModel } from './mechModel';
import type { TacticalCamera, Viewport } from './camera';
import { ContactShadowLayer } from './contactShadows';
import { advanceWeaponRecoil, triggerWeaponRecoil } from './weaponModels';

export interface Interpolated {
  x: number;
  y: number;
  facing: number;
  torso: number;
}

interface MotionSample {
  prev: Interpolated;
  cur: Interpolated;
}

export interface EntityView {
  model: MechModel;
  signature: number;
  ring: Mesh;
  hoverRing: Mesh;
}

const PICK_DELTA = new Vector3();
const DEFAULT_VISUAL: Weapon['visual'] = {
  style: 'beam',
  colour: '#ffffff',
  width: 2,
  arc: 0,
};

function damageSignature(entity: MechEntity): number {
  let bits = entity.destroyed ? 1 : 0;
  for (let index = 0; index < LOCATIONS.length; index += 1) {
    const location = LOCATIONS[index];
    if (location !== undefined && entity.locations[location].destroyed) {
      bits |= 1 << (index + 1);
    }
  }
  for (let index = 0; index < entity.weapons.length; index += 1) {
    if (entity.weapons[index]?.destroyed === true) bits = Math.imul(bits ^ (index + 17), 16777619);
  }
  return (bits >>> 0) * 8 + entity.team;
}

/** Owns model rebuilds and the two sim samples used for smooth rendering. */
export class UnitViews {
  private readonly views = new Map<EntityId, EntityView>();
  private readonly samples = new Map<EntityId, MotionSample>();
  private readonly interpolated = new Map<EntityId, Interpolated>();
  private readonly mountCycles = new Map<string, number>();
  private readonly placed = new Set<EntityId>();
  private readonly shadows: ContactShadowLayer;

  constructor(
    private readonly scene: Scene,
    private readonly heightAt: (x: number, y: number) => number,
  ) {
    this.shadows = new ContactShadowLayer(heightAt);
    scene.add(this.shadows.mesh);
  }

  dispose(): void {
    for (const view of this.views.values()) {
      disposeModel(view.model.root);
      this.disposeRings(view);
      this.scene.remove(view.model.root, view.ring, view.hoverRing);
    }
    this.scene.remove(this.shadows.mesh);
    this.shadows.dispose();
  }

  beginFrame(deltaSeconds = 0): void {
    this.shadows.begin();
    this.placed.clear();
    for (const view of this.views.values()) {
      for (const weapon of view.model.weapons) advanceWeaponRecoil(weapon, deltaSeconds);
    }
  }

  markPlaced(id: EntityId): void {
    this.placed.add(id);
  }

  placeShadow(entity: MechEntity, at: Interpolated, lift: number): void {
    this.shadows.place(at, radiusFor(entity.tonnage), at.facing, lift);
  }

  finishFrame(): void {
    this.shadows.commit();
  }

  snapshot(world: World): void {
    for (const entity of world.entities) {
      const existing = this.samples.get(entity.id);
      if (existing === undefined) {
        const cur: Interpolated = {
          x: entity.pos.x,
          y: entity.pos.y,
          facing: entity.facing,
          torso: entity.torsoOffset,
        };
        this.samples.set(entity.id, { prev: { ...cur }, cur });
        continue;
      }
      const { prev, cur } = existing;
      prev.x = cur.x;
      prev.y = cur.y;
      prev.facing = cur.facing;
      prev.torso = cur.torso;
      cur.x = entity.pos.x;
      cur.y = entity.pos.y;
      cur.facing = entity.facing;
      cur.torso = entity.torsoOffset;
    }
  }

  interpolate(world: World, alpha: number): void {
    for (const entity of world.entities) {
      let slot = this.interpolated.get(entity.id);
      if (slot === undefined) {
        slot = { x: 0, y: 0, facing: 0, torso: 0 };
        this.interpolated.set(entity.id, slot);
      }

      const sample = this.samples.get(entity.id);
      if (sample === undefined) {
        slot.x = entity.pos.x;
        slot.y = entity.pos.y;
        slot.facing = entity.facing;
        slot.torso = entity.torsoOffset;
        continue;
      }
      slot.x = sample.prev.x + (sample.cur.x - sample.prev.x) * alpha;
      slot.y = sample.prev.y + (sample.cur.y - sample.prev.y) * alpha;
      slot.facing = normaliseAngle(
        sample.prev.facing + angleDifference(sample.prev.facing, sample.cur.facing) * alpha,
      );
      slot.torso = sample.prev.torso + (sample.cur.torso - sample.prev.torso) * alpha;
    }
  }

  at(entity: MechEntity): Interpolated {
    return this.interpolated.get(entity.id) ?? {
      x: entity.pos.x,
      y: entity.pos.y,
      facing: entity.facing,
      torso: entity.torsoOffset,
    };
  }

  positionOf(id: EntityId): Vec2 | null {
    return this.interpolated.get(id) ?? this.samples.get(id)?.cur ?? null;
  }

  /** Chooses the physical copy that fired when a design carries duplicate weapon ids. */
  fireMount(id: EntityId, weaponId: string, muzzle: Vector3): boolean {
    const view = this.views.get(id);
    if (view === undefined || !view.model.root.visible || !this.placed.has(id)) return false;

    let count = 0;
    for (const rig of view.model.weapons) if (rig.weaponId === weaponId) count += 1;
    if (count === 0) return false;

    const key = `${id}:${weaponId}`;
    const wanted = (this.mountCycles.get(key) ?? 0) % count;
    let seen = 0;
    for (const rig of view.model.weapons) {
      if (rig.weaponId !== weaponId) continue;
      if (seen !== wanted) {
        seen += 1;
        continue;
      }
      rig.muzzle.getWorldPosition(muzzle);
      triggerWeaponRecoil(rig);
      this.mountCycles.set(key, (wanted + 1) % count);
      return true;
    }
    return false;
  }

  viewFor(world: World, entity: MechEntity): EntityView {
    const signature = damageSignature(entity);
    const existing = this.views.get(entity.id);
    if (existing !== undefined && existing.signature === signature) return existing;

    if (existing !== undefined) {
      this.scene.remove(existing.model.root, existing.ring, existing.hoverRing);
      disposeModel(existing.model.root);
      this.disposeRings(existing);
    }

    const chassis = world.catalog.chassis.get(entity.chassisId);
    const mounts = entity.weapons
      .filter((mount) => !mount.destroyed)
      .map((mount) => {
        const weapon = world.catalog.weapons.get(mount.weaponId);
        return {
          weaponId: mount.weaponId,
          location: mount.location,
          type: weapon?.type ?? ('energy' as const),
          tonnage: weapon?.tonnage ?? 1,
          projectiles: weapon?.projectiles ?? 1,
          recoil: weapon?.recoil ?? 0,
          visual: weapon?.visual ?? DEFAULT_VISUAL,
        };
      });

    const model = buildMechModel(
      chassis?.silhouette ?? DEFAULT_SILHOUETTE,
      chassis?.traits ?? [],
      entity.tonnage,
      teamColour(entity.team),
      entity.destroyed,
      mounts,
      new Set(LOCATIONS.filter((location) => entity.locations[location].destroyed)),
      chassis?.hardpoints,
      chassis?.id ?? null,
    );

    const radius = radiusFor(entity.tonnage);
    const ring = this.selectionRing(radius, UI.selection, 1.2, 1.42, 0.9);
    const hoverRing = this.selectionRing(
      radius,
      entity.team === world.playerTeam ? UI.friendly : UI.hostile,
      1.5,
      1.66,
      0.85,
    );

    model.root.userData.entityId = entity.id;
    this.scene.add(model.root, ring, hoverRing);
    const view = { model, signature, ring, hoverRing };
    this.views.set(entity.id, view);
    return view;
  }

  screenBodyOf(
    entity: MechEntity,
    camera: TacticalCamera,
    viewport: Viewport,
  ): { x: number; y: number; radius: number } {
    const at = this.at(entity);
    const ground = this.heightAt(at.x, at.y);
    const size = radiusFor(entity.tonnage);
    const centre = camera.worldToScreen(at, viewport, ground + size);
    const top = camera.worldToScreen(at, viewport, ground + size * 2);
    return { x: centre.x, y: centre.y, radius: Math.abs(top.y - centre.y) };
  }

  entityAtScreen(
    world: World,
    screen: Vec2,
    radiusPixels: number,
    camera: TacticalCamera,
    viewport: Viewport,
    wanted: (entity: MechEntity) => boolean,
  ): MechEntity | null {
    const visible = (entity: MechEntity): boolean =>
      (world.vision === null ||
        entity.team === world.vision.team ||
        world.vision.visible.has(entity.id)) &&
      wanted(entity);

    const ray = camera.rayAt(screen, viewport);
    let bodyHit: MechEntity | null = null;
    let bodyAlong = Infinity;
    for (const entity of world.entities) {
      if (!visible(entity) || !isOperational(entity)) continue;
      const view = this.views.get(entity.id);
      if (view === undefined || !view.model.root.visible) continue;

      const at = this.at(entity);
      const height = view.model.height;
      const radius = radiusFor(entity.tonnage) * 1.2;
      const lift = jumpHeight(entity) * radiusFor(entity.tonnage) * 2.2;
      const footY = this.heightAt(at.x, at.y) + lift;

      PICK_DELTA.set(at.x - ray.origin.x, footY - ray.origin.y, at.y - ray.origin.z);
      const d = ray.direction;
      const dDotUp = d.y;
      const denominator = 1 - dDotUp * dDotUp;
      let along: number;
      let up: number;
      if (denominator < 1e-6) {
        along = PICK_DELTA.dot(d);
        up = 0;
      } else {
        const deltaDotD = PICK_DELTA.dot(d);
        const deltaDotUp = PICK_DELTA.y;
        along = (deltaDotD - dDotUp * deltaDotUp) / denominator;
        up = Math.max(0, Math.min(height, along * dDotUp - deltaDotUp));
        along = deltaDotD + up * dDotUp;
      }
      if (along < 0 || along >= bodyAlong) continue;

      const gapX = PICK_DELTA.x - along * d.x;
      const gapY = PICK_DELTA.y + up - along * d.y;
      const gapZ = PICK_DELTA.z - along * d.z;
      if (gapX * gapX + gapY * gapY + gapZ * gapZ > radius * radius) continue;
      bodyHit = entity;
      bodyAlong = along;
    }
    if (bodyHit !== null) return bodyHit;

    let best: MechEntity | null = null;
    let bestRange = radiusPixels;
    for (const entity of world.entities) {
      if (!visible(entity)) continue;
      const at = this.at(entity);
      const body = camera.worldToScreen(
        at,
        viewport,
        this.heightAt(at.x, at.y) + radiusFor(entity.tonnage),
      );
      const range = Math.hypot(body.x - screen.x, body.y - screen.y);
      if (range < bestRange) {
        best = entity;
        bestRange = range;
      }
    }
    return best;
  }

  private selectionRing(
    radius: number,
    colour: number,
    inner: number,
    outer: number,
    opacity: number,
  ): Mesh {
    const ring = new Mesh(
      new RingGeometry(radius * inner, radius * outer, 28),
      new MeshBasicMaterial({ color: colour, transparent: true, opacity }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    return ring;
  }

  private disposeRings(view: EntityView): void {
    for (const ring of [view.ring, view.hoverRing]) {
      ring.geometry.dispose();
      (ring.material as MeshBasicMaterial).dispose();
    }
  }
}
