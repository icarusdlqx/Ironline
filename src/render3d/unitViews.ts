import { Mesh, MeshBasicMaterial, RingGeometry, Scene, Vector3 } from 'three';
import { LOCATIONS } from '../schema/common';
import { teamColour, UI } from '../render/palette';
import { DEFAULT_SILHOUETTE, radiusFor } from '../render/shape';
import { angleDifference } from '../sim/math';
import type { EntityId, MechEntity, Vec2, World } from '../sim/types';
import type { Weapon } from '../schema/weapon';
import type { SimEvent } from '../sim/events';
import { buildMechModel, disposeModel, type MechModel } from './mechModel';
import type { TacticalCamera, Viewport } from './camera';
import { ContactShadowLayer } from './contactShadows';
import { damageWearTier } from './damageLedger';
import { collectLocationAnchors, locationWorldAnchor, type LocationAnchors } from './locationAnchors';
import { advanceWeaponRecoil, triggerWeaponRecoil } from './weaponModels';
import { advanceHullRecoil, triggerHullRecoil } from './machineCulture';
import { modelDamageSignature, sealedTargetOffset, writeInterpolatedPose } from './unitVisualState';
import { advanceStartupSequence, setStartupPowered } from './startupLights';
import { presentMachinePowerEvent } from './unitCultureEvents';
import { UnitPicking } from './unitPicking';
import { applyModelDetail } from './modelDetail';
import {
  battlefieldDetailForDistance,
  type ModelDetail,
} from './renderQuality';
import { setMachineMotionLowFx } from './machineMotion';

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
  anchors: LocationAnchors;
}

const DEFAULT_VISUAL: Weapon['visual'] = {
  style: 'beam',
  colour: '#ffffff',
  width: 2,
  arc: 0,
};

/** Owns model rebuilds and the two sim samples used for smooth rendering. */
export class UnitViews {
  private readonly views = new Map<EntityId, EntityView>();
  private readonly samples = new Map<EntityId, MotionSample>();
  private readonly interpolated = new Map<EntityId, Interpolated>();
  private readonly mountCycles = new Map<string, number>();
  private readonly placed = new Set<EntityId>();
  private readonly placedAt = new Map<EntityId, Interpolated>();
  private readonly shadows: ContactShadowLayer;
  private readonly picking: UnitPicking;
  private detail: ModelDetail = 'structure';
  private lowFx = false;

  constructor(
    private readonly scene: Scene,
    heightAt: (x: number, y: number) => number,
    private readonly reducedMotion = false,
  ) {
    this.shadows = new ContactShadowLayer(heightAt);
    this.picking = new UnitPicking(heightAt, (entity) => this.at(entity), (id) => this.views.get(id));
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
      advanceHullRecoil(view.model.hullRecoil, deltaSeconds);
      if (view.model.root.visible) advanceStartupSequence(view.model, deltaSeconds, this.reducedMotion);
      for (const weapon of view.model.weapons) {
        advanceWeaponRecoil(weapon, deltaSeconds, this.reducedMotion, this.lowFx);
      }
    }
  }

  setRenderQuality(distance: number, lowFx: boolean): void {
    const detail = battlefieldDetailForDistance(distance, lowFx, this.detail);
    if (detail === this.detail && lowFx === this.lowFx) return;
    this.detail = detail;
    this.lowFx = lowFx;
    for (const view of this.views.values()) {
      applyModelDetail(view.model.root, detail);
      setMachineMotionLowFx(view.model.machineMotion, lowFx);
    }
  }

  markPlaced(id: EntityId, at?: Interpolated): void {
    this.placed.add(id);
    if (at === undefined) return;
    const pose = this.placedAt.get(id);
    if (pose === undefined) this.placedAt.set(id, { ...at });
    else Object.assign(pose, at);
  }

  placeShadow(entity: MechEntity, at: Interpolated, lift: number): void {
    this.shadows.place(at, radiusFor(entity.tonnage), at.facing, lift);
  }

  finishFrame(): void {
    this.shadows.commit();
  }

  consumeEvents(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type !== 'shutdown' && event.type !== 'restart') continue;
      const view = this.views.get(event.entityId);
      presentMachinePowerEvent(view?.model, event.type, this.reducedMotion);
    }
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
      const faction = world.catalog.chassis.get(entity.chassisId)?.faction ?? 'linewrought';
      writeInterpolatedPose(slot, sample, alpha, faction);
      if (faction === 'aurelian') slot.torso = sealedTargetOffset(world, entity, slot);
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

  currentPositionOf(id: EntityId): Vec2 | null {
    return this.samples.get(id)?.cur ?? this.interpolated.get(id) ?? null;
  }

  canLocate(id: EntityId): boolean {
    const view = this.views.get(id);
    return view !== undefined && view.model.root.visible && this.placed.has(id);
  }

  locationOf(id: EntityId, location: (typeof LOCATIONS)[number], out: Vector3): boolean {
    const view = this.views.get(id);
    if (view === undefined || !this.canLocate(id)) return false;
    const placed = this.placedAt.get(id);
    const current = this.samples.get(id)?.cur;
    if (
      placed !== undefined &&
      current !== undefined &&
      (Math.hypot(placed.x - current.x, placed.y - current.y) > 0.01 ||
        Math.abs(angleDifference(placed.facing, current.facing)) > 0.002 ||
        Math.abs(placed.torso - current.torso) > 0.002)
    ) return false;
    return locationWorldAnchor(view.anchors, location, out);
  }

  /** Chooses the physical copy that fired when a design carries duplicate weapon ids. */
  fireMount(id: EntityId, weaponId: string, muzzle: Vector3, breech?: Vector3): boolean {
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
      if (breech !== undefined) rig.breech.getWorldPosition(breech);
      triggerWeaponRecoil(rig);
      if (view.model.faction === 'linewrought') {
        if (!this.reducedMotion) triggerHullRecoil(view.model.hullRecoil, view.model.culture, rig.travel);
      }
      this.mountCycles.set(key, (wanted + 1) % count);
      return true;
    }
    return false;
  }

  viewFor(world: World, entity: MechEntity): EntityView {
    const chassis = world.catalog.chassis.get(entity.chassisId);
    const faction = chassis?.faction ?? 'linewrought';
    const signature = modelDamageSignature(entity, faction);
    const existing = this.views.get(entity.id);
    if (existing !== undefined && existing.signature === signature) return existing;

    if (existing !== undefined) {
      this.scene.remove(existing.model.root, existing.ring, existing.hoverRing);
      disposeModel(existing.model.root);
      this.disposeRings(existing);
    }

    const wear = {} as Partial<Record<(typeof LOCATIONS)[number], ReturnType<typeof damageWearTier>>>;
    for (const location of LOCATIONS) wear[location] = damageWearTier(entity.locations[location]);
    const mounts = entity.weapons
      .filter((mount) => faction === 'aurelian' || !mount.destroyed)
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
      wear,
      faction,
    );
    applyModelDetail(model.root, this.detail);
    setMachineMotionLowFx(model.machineMotion, this.lowFx);
    if (faction === 'aurelian') setStartupPowered(model, entity.shutdownRemaining <= 0);

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
    const view = { model, signature, ring, hoverRing, anchors: collectLocationAnchors(model.root) };
    this.views.set(entity.id, view);
    return view;
  }

  screenBodyOf(
    entity: MechEntity,
    camera: TacticalCamera,
    viewport: Viewport,
  ): { x: number; y: number; radius: number } {
    return this.picking.screenBodyOf(entity, camera, viewport);
  }

  entityAtScreen(
    world: World,
    screen: Vec2,
    radiusPixels: number,
    camera: TacticalCamera,
    viewport: Viewport,
    wanted: (entity: MechEntity) => boolean,
  ): MechEntity | null {
    return this.picking.entityAtScreen(world, screen, radiusPixels, camera, viewport, wanted);
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
