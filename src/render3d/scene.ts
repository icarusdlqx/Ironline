import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { TerrainMapData } from '../schema/map';
import type { SimEvent } from '../sim/events';
import { angleDifference, normaliseAngle } from '../sim/math';
import { jumpHeight } from '../sim/movement';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../sim/types';
import { teamColour, UI } from '../render/palette';
import { DEFAULT_SILHOUETTE, radiusFor } from '../render/shape';
import { TacticalCamera, type Viewport } from './camera';
import { FogLayer } from './fog';
import { buildMechModel, disposeModel, type MechModel } from './mechModel';
import { buildTerrain, type TerrainMesh } from './terrain';
import { TracerLayer } from './tracers';

export interface ViewState {
  selection: ReadonlySet<EntityId>;
  hovered: EntityId | null;
  cursor: Vec2 | null;
  selectionBox: { a: Vec2; b: Vec2 } | null;
  supportRun: { at: Vec2; heading: number; length: number; width: number } | null;
  orderMode: 'move' | 'run' | 'attack' | 'called_shot' | 'jump' | null;
}

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

interface EntityView {
  model: MechModel;
  signature: string;
  ring: Mesh;
}

function damageSignature(entity: MechEntity): string {
  const lost = Object.values(entity.locations)
    .map((state) => (state.destroyed ? '1' : '0'))
    .join('');
  return `${entity.team}:${lost}:${entity.destroyed ? 'x' : 'o'}`;
}

export class Renderer {
  readonly camera = new TacticalCamera();
  readonly scene = new Scene();

  private readonly renderer: WebGLRenderer;
  private readonly terrain: TerrainMesh;
  private readonly fog: FogLayer;
  private readonly tracers = new TracerLayer();
  private readonly markers = new Group();
  private readonly views = new Map<EntityId, EntityView>();
  private readonly samples = new Map<EntityId, MotionSample>();
  private readonly interpolated = new Map<EntityId, Interpolated>();
  private readonly host: HTMLElement;

  constructor(host: HTMLElement, world: World, mapData: TerrainMapData) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x0d1013);
    this.scene.fog = new Fog(0x161c1f, 1_100, 3_000);

    this.terrain = buildTerrain(world.terrain, mapData);
    this.scene.add(this.terrain.mesh);

    // Ground beyond the battlefield. Without it the map ends at a hard edge
    // with the void behind it, which reads as a bug rather than as a horizon.
    const surround = new Mesh(
      new PlaneGeometry(
        world.terrain.width * world.terrain.tileSize * 9,
        world.terrain.height * world.terrain.tileSize * 9,
      ),
      new MeshBasicMaterial({ color: 0x161c1f }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(
      (world.terrain.width * world.terrain.tileSize) / 2,
      -3,
      (world.terrain.height * world.terrain.tileSize) / 2,
    );
    this.scene.add(surround);

    this.fog = new FogLayer(world.terrain, this.terrain.heightAt);
    this.scene.add(this.fog.mesh);
    this.scene.add(this.markers);
    this.scene.add(this.tracers.group);

    // A low sun across the map so the hills have a lit and a shadowed face.
    const sun = new DirectionalLight(0xfff0dc, 1.5);
    sun.position.set(-420, 700, -260);
    sun.castShadow = true;
    this.scene.add(sun, new AmbientLight(0x6f8296, 1.1));

    const width = world.terrain.width * world.terrain.tileSize;
    const height = world.terrain.height * world.terrain.tileSize;
    this.camera.setBounds(width, height);

    const lance = world.entities.filter((entity) => entity.team === (world.playerTeam ?? 0));
    const centroid = lance.reduce(
      (sum, entity) => ({
        x: sum.x + entity.pos.x / lance.length,
        y: sum.y + entity.pos.y / lance.length,
      }),
      { x: 0, y: 0 },
    );
    this.camera.centreOn(lance.length === 0 ? { x: width / 2, y: height / 2 } : centroid);

    this.resize();
    this.snapshot(world);
  }

  /** The canvas the input layer listens on. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get viewport(): Viewport {
    return { width: this.host.clientWidth || 1, height: this.host.clientHeight || 1 };
  }

  /** The terrain mesh, so a click can land on the ridge the player aimed at. */
  get groundMesh(): Mesh {
    return this.terrain.mesh;
  }

  resize(): void {
    const { width, height } = this.viewport;
    // The canvas has to be laid out at the size the pointer is measured
    // against. Skipping the style update leaves it displayed at its drawing
    // buffer size, so on any screen with a device pixel ratio above one the
    // canvas covers twice the area the layout thinks it does and every click
    // lands somewhere else entirely.
    this.renderer.setSize(width, height);
    this.camera.update({ width, height });
  }

  destroy(): void {
    for (const view of this.views.values()) disposeModel(view.model.root);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  snapshot(world: World): void {
    for (const entity of world.entities) {
      const cur: Interpolated = {
        x: entity.pos.x,
        y: entity.pos.y,
        facing: entity.facing,
        torso: entity.torsoOffset,
      };
      const existing = this.samples.get(entity.id);
      this.samples.set(entity.id, { prev: existing?.cur ?? cur, cur });
    }
  }

  consumeEvents(world: World, events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type !== 'weapon_fired' && event.type !== 'projectile_hit') continue;

      const weapon = world.catalog.weapons.get(event.weaponId);
      const colour =
        weapon === undefined ? 0xffffff : parseInt(weapon.visual.colour.slice(1), 16);

      if (event.type === 'projectile_hit') {
        const at = this.positionOf(event.targetId);
        if (at !== null) this.tracers.impact(at, this.terrain.heightAt(at.x, at.y), colour);
        continue;
      }

      const shooter = this.positionOf(event.shooterId);
      const target = this.positionOf(event.targetId);
      if (shooter === null || target === null) continue;

      this.tracers.fire(
        shooter,
        target,
        weapon?.type ?? 'energy',
        weapon?.projectiles ?? 1,
        colour,
        this.terrain.heightAt,
      );
    }
  }

  private interpolate(world: World, alpha: number): void {
    this.interpolated.clear();
    for (const entity of world.entities) {
      const sample = this.samples.get(entity.id);
      if (sample === undefined) {
        this.interpolated.set(entity.id, {
          x: entity.pos.x,
          y: entity.pos.y,
          facing: entity.facing,
          torso: entity.torsoOffset,
        });
        continue;
      }
      this.interpolated.set(entity.id, {
        x: sample.prev.x + (sample.cur.x - sample.prev.x) * alpha,
        y: sample.prev.y + (sample.cur.y - sample.prev.y) * alpha,
        facing: normaliseAngle(
          sample.prev.facing + angleDifference(sample.prev.facing, sample.cur.facing) * alpha,
        ),
        torso: sample.prev.torso + (sample.cur.torso - sample.prev.torso) * alpha,
      });
    }
  }

  private viewFor(world: World, entity: MechEntity): EntityView {
    const signature = damageSignature(entity);
    const existing = this.views.get(entity.id);
    if (existing !== undefined && existing.signature === signature) return existing;

    if (existing !== undefined) {
      this.scene.remove(existing.model.root, existing.ring);
      disposeModel(existing.model.root);
    }

    const chassis = world.catalog.chassis.get(entity.chassisId);
    const mounts = entity.weapons
      .filter((mount) => !mount.destroyed)
      .map((mount) => {
        const weapon = world.catalog.weapons.get(mount.weaponId);
        return {
          location: mount.location,
          type: weapon?.type ?? ('energy' as const),
          tonnage: weapon?.tonnage ?? 1,
          projectiles: weapon?.projectiles ?? 1,
        };
      });

    const model = buildMechModel(
      chassis?.silhouette ?? DEFAULT_SILHOUETTE,
      chassis?.traits ?? [],
      entity.tonnage,
      teamColour(entity.team),
      entity.destroyed,
      mounts,
    );

    const radius = radiusFor(entity.tonnage);
    const ring = new Mesh(
      new RingGeometry(radius * 1.2, radius * 1.42, 28),
      new MeshBasicMaterial({ color: UI.selection, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;

    this.scene.add(model.root, ring);
    const view: EntityView = { model, signature, ring };
    this.views.set(entity.id, view);
    return view;
  }

  draw(world: World, alpha: number, deltaSeconds: number, view: ViewState): void {
    this.interpolate(world, alpha);

    for (const entity of world.entities) {
      const seen =
        world.vision === null ||
        entity.team === world.vision.team ||
        world.vision.visible.has(entity.id);

      const shown = this.viewFor(world, entity);
      shown.model.root.visible = seen;
      shown.ring.visible = seen && view.selection.has(entity.id) && isOperational(entity);
      if (!seen) continue;

      const at = this.interpolated.get(entity.id) ?? {
        x: entity.pos.x,
        y: entity.pos.y,
        facing: entity.facing,
        torso: entity.torsoOffset,
      };

      const ground = this.terrain.heightAt(at.x, at.y);
      const lift = jumpHeight(entity) * radiusFor(entity.tonnage) * 2.2;

      shown.model.root.position.set(at.x, ground + lift, at.y);
      // Simulation headings are measured clockwise on a screen whose y runs
      // down; the same angle round the world's up axis runs the other way.
      shown.model.root.rotation.y = -at.facing;
      shown.model.torso.rotation.y = -at.torso;

      shown.ring.position.set(at.x, ground + 1.2, at.y);
    }

    this.drawMarkers(world, view);
    this.tracers.update(deltaSeconds);
    this.fog.update(world.terrain, world.vision);

    const viewport = this.viewport;
    this.camera.update(viewport);
    this.renderer.render(this.scene, this.camera.camera);
  }

  private drawMarkers(world: World, view: ViewState): void {
    this.markers.clear();

    for (const zone of world.zones) {
      const colour = zone.owner === null ? UI.ghost : teamColour(zone.owner);
      this.markers.add(this.groundRing(zone, zone.radius, colour, 0.55));
    }

    for (const reveal of world.reveals) {
      if (world.playerTeam !== null && reveal.team !== world.playerTeam) continue;
      this.markers.add(
        this.groundRing({ x: reveal.x, y: reveal.y }, reveal.radius, UI.selection, 0.3),
      );
    }

    for (const pending of world.support.pending) {
      this.markers.add(this.groundRing(pending.target, 26, UI.attackMarker, 0.85));
    }

    for (const entity of world.entities) {
      if (!view.selection.has(entity.id) || !isOperational(entity)) continue;

      if (view.orderMode === 'jump' && entity.jumpRange > 0 && entity.jumpCooldown <= 0) {
        this.markers.add(this.groundRing(entity.pos, entity.jumpRange, UI.moveMarker, 0.5));
      }

      if (entity.path.length > 0) {
        const at = this.interpolated.get(entity.id) ?? entity.pos;
        const points = [at, ...entity.path.slice(entity.pathIndex)].map(
          (point) => new Vector3(point.x, this.terrain.heightAt(point.x, point.y) + 1.5, point.y),
        );
        this.markers.add(
          new Line(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: UI.moveMarker, transparent: true, opacity: 0.7 }),
          ),
        );
      }
    }
  }

  /** A flat ring laid on the ground, lifted just clear of the terrain. */
  private groundRing(at: Vec2, radius: number, colour: number, opacity: number): Mesh {
    const ring = new Mesh(
      new RingGeometry(Math.max(1, radius - 1.6), radius, 40),
      new MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, this.terrain.heightAt(at.x, at.y) + 1, at.y);
    return ring;
  }

  positionOf(id: EntityId): Vec2 | null {
    return this.interpolated.get(id) ?? this.samples.get(id)?.cur ?? null;
  }

  entityAt(world: World, point: Vec2, radius: number): MechEntity | null {
    let best: MechEntity | null = null;
    let bestRange = radius;

    for (const entity of world.entities) {
      if (world.vision !== null && entity.team !== world.vision.team) {
        if (!world.vision.visible.has(entity.id)) continue;
      }
      const at = this.interpolated.get(entity.id) ?? entity.pos;
      const range = Math.hypot(at.x - point.x, at.y - point.y);
      if (range < bestRange) {
        best = entity;
        bestRange = range;
      }
    }

    return best;
  }

  spawnSmoke(at: Vec2): void {
    this.tracers.spawnSmoke(at, this.terrain.heightAt(at.x, at.y));
  }

  teamTint(team: number): number {
    return teamColour(team);
  }
}
