import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PCFSoftShadowMap,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LOCATIONS } from '../schema/common';
import type { Atmosphere } from '../schema/atmosphere';
import type { TerrainMapData } from '../schema/map';
import type { SimEvent } from '../sim/events';
import { angleDifference, normaliseAngle } from '../sim/math';
import { jumpHeight } from '../sim/movement';
import { tileExplored } from '../sim/sensors';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../sim/types';
import { teamColour, UI } from '../render/palette';
import { DEFAULT_SILHOUETTE, radiusFor } from '../render/shape';
import { buildAtmosphereRig, surroundColour } from './atmosphere';
import { JetLayer, ScarLayer, SmokeLayer } from './effects';
import { TacticalCamera, type Viewport } from './camera';
import { FogLayer } from './fog';
import { buildMechModel, disposeModel, type MechModel } from './mechModel';
import { PropLayer } from './props';
import { buildTerrain, type TerrainMesh } from './terrain';
import { TracerLayer } from './tracers';

export interface ViewState {
  selection: ReadonlySet<EntityId>;
  hovered: EntityId | null;
  cursor: Vec2 | null;
  selectionBox: { a: Vec2; b: Vec2 } | null;
  supportRun: { at: Vec2; heading: number; length: number; width: number } | null;
  orderMode: 'move' | 'run' | 'attack' | 'attack_move' | 'called_shot' | 'jump' | null;
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
  /** Drawn under the pointer, so the player can see what a click would hit. */
  hoverRing: Mesh;
}

/** The state a mech's body is in, as distinct from where the sim says it is. */
interface AnimationState {
  /** Walk cycle, in radians. One π per footstep. */
  phase: number;
  /** Eased 0..1: how much of the full stride the legs are swinging. */
  amp: number;
  lastAt: Vec2 | null;
  lastStep: number;
  /** Death fall, 0 standing to 1 down. */
  fall: number;
  /** Pitch and roll of the ground under the feet, eased so the hull is not jittery. */
  pitch: number;
  roll: number;
  /** Whether the wreck has already hit the ground and raised its dust. */
  landedFall: boolean;
}

interface MuzzleFlash {
  light: PointLight;
  ttl: number;
}

/** Scratch for reading a knee joint's world position, so the frame allocates none. */
const NOZZLE = new Vector3();

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
  private readonly props: PropLayer;
  private readonly fog: FogLayer;
  private readonly tracers = new TracerLayer();
  private readonly jets = new JetLayer();
  private readonly smoke: SmokeLayer;
  private readonly scars = new ScarLayer();
  /** Seconds since the battle opened, so the jet flicker has a clock to run on. */
  private elapsed = 0;
  private readonly markers = new Group();
  private readonly views = new Map<EntityId, EntityView>();
  private readonly samples = new Map<EntityId, MotionSample>();
  private readonly interpolated = new Map<EntityId, Interpolated>();
  /** Walk cycles and death falls, kept outside the views so rebuilds keep pose. */
  private readonly animation = new Map<EntityId, AnimationState>();
  /** Reads as an impact magnitude; decays every frame. */
  private shakeAmplitude = 0;
  private shakeTime = 0;
  /** Brief lights on muzzles, pooled because lights are not free. */
  private readonly flashes: MuzzleFlash[] = [];
  /** Reported when an animated leg plants, so footsteps can sound. */
  onFootfall: ((at: Vec2, tonnage: number) => void) | null = null;
  private readonly host: HTMLElement;

  /** The authored map, kept for overlays like the minimap that draw from it. */
  readonly mapData: TerrainMapData;

  constructor(host: HTMLElement, world: World, mapData: TerrainMapData, atmosphere: Atmosphere) {
    this.mapData = mapData;
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true });
    // Capped below the display's own ratio on Retina: the scene is fill-bound
    // there, and 1.5 is ~44% fewer pixels than 2 for a difference nobody has
    // picked out of a moving battle. Effects stack additive transparency, so
    // fill is what firefight frame spikes are made of.
    this.renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio ?? 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;

    const mapWidth = world.terrain.width * world.terrain.tileSize;
    const mapHeight = world.terrain.height * world.terrain.tileSize;

    // The lights and air are aimed at the middle of the map, so the target has
    // to exist before the rig that points at it.
    const midpoint = new Object3D();
    midpoint.position.set(mapWidth / 2, 0, mapHeight / 2);
    this.scene.add(midpoint);

    const rig = buildAtmosphereRig(
      atmosphere,
      midpoint,
      new Vector3(mapWidth / 2, 0, mapHeight / 2),
      Math.max(mapWidth, mapHeight) * 0.78,
    );

    this.renderer.toneMappingExposure = rig.exposure;
    host.appendChild(this.renderer.domElement);

    this.scene.background = rig.sky;
    this.scene.fog = rig.fog;

    this.terrain = buildTerrain(world.terrain, mapData, rig.tint);
    this.scene.add(this.terrain.mesh);

    this.props = new PropLayer(world.terrain, mapData, this.terrain.heightAt, rig.tint);
    this.scene.add(this.props.group);

    // Ground beyond the battlefield. Without it the map ends at a hard edge
    // with the void behind it, which reads as a bug rather than as a horizon.
    // Painted the fog's colour so the join is invisible.
    const surround = new Mesh(
      new PlaneGeometry(mapWidth * 9, mapHeight * 9),
      new MeshBasicMaterial({ color: surroundColour(rig) }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(mapWidth / 2, -3, mapHeight / 2);
    this.scene.add(surround);

    this.fog = new FogLayer(world.terrain, this.terrain.heightAt);
    this.scene.add(this.fog.mesh);
    this.scene.add(this.markers);
    this.scene.add(this.tracers.group);

    // Smoke fades into the distance rather than into transparency, so it needs
    // to know what the distance looks like.
    this.smoke = new SmokeLayer(surroundColour(rig));
    this.scene.add(this.smoke.mesh, this.scars.mesh, this.jets.group);

    // A key light across the map so hills and hulls have a lit face and a
    // shadowed one, a cool fill from the opposite side so the shadowed face is
    // readable rather than black, and sky/ground ambience to grade the curves
    // that the chamfered plates have. What each of those is now comes off the
    // map's atmosphere rather than out of this file.
    this.scene.add(rig.sun, rig.fill, rig.hemisphere);

    this.camera.setBounds(mapWidth, mapHeight);

    const lance = world.entities.filter((entity) => entity.team === (world.playerTeam ?? 0));
    const centroid = lance.reduce(
      (sum, entity) => ({
        x: sum.x + entity.pos.x / lance.length,
        y: sum.y + entity.pos.y / lance.length,
      }),
      { x: 0, y: 0 },
    );
    this.camera.centreOn(lance.length === 0 ? { x: mapWidth / 2, y: mapHeight / 2 } : centroid);
    // A mission with no briefing to dismiss opens straight into the drop.
    this.camera.beginDropIn();

    this.resize();
    this.snapshot(world);
  }

  /** The canvas the input layer listens on. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** How many draw calls the last frame issued, for the perf overlay. */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
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
      // The camera flinches for the big things, scaled down with distance.
      if (event.type === 'mech_destroyed' || event.type === 'ammo_explosion') {
        const at = this.positionOf(event.entityId);
        if (at !== null) this.addShake(6 * this.nearness(at));
        // A wreck burns for the rest of the battle, which is how a player reads
        // the shape of a fight they were not watching a minute ago.
        if (at !== null && event.type === 'mech_destroyed') {
          this.smoke.start(at, this.terrain.heightAt(at.x, at.y));
          this.scars.mark(at, this.terrain.heightAt(at.x, at.y), 22, 0.55);
        }
      } else if (event.type === 'projectile_hit' && event.damage >= 14) {
        const at = this.positionOf(event.targetId);
        if (at !== null) this.addShake(1.6 * this.nearness(at));
      } else if (event.type === 'jump_landed') {
        this.addShake(1.4 * this.nearness({ x: event.x, y: event.y }));
      }

      if (event.type !== 'weapon_fired' && event.type !== 'projectile_hit') continue;

      const weapon = world.catalog.weapons.get(event.weaponId);
      const colour =
        weapon === undefined ? 0xffffff : parseInt(weapon.visual.colour.slice(1), 16);

      if (event.type === 'projectile_hit') {
        const at = this.positionOf(event.targetId);
        if (at !== null) {
          this.tracers.impact(at, this.terrain.heightAt(at.x, at.y), colour);
          // What missed the mech hit the ground behind it. Energy weapons leave
          // a scorch, ballistics turn the earth over.
          const damage = weapon?.damage ?? 5;
          this.scars.mark(
            { x: at.x + (event.tick % 7) - 3, y: at.y + (event.tick % 5) - 2 },
            this.terrain.heightAt(at.x, at.y),
            3 + Math.min(9, damage * 0.35),
            weapon?.type === 'energy' ? 1 : 0.25,
          );
        }
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
      this.muzzleLight(shooter, colour, weapon?.damage ?? 5);
    }
  }

  private nearness(at: Vec2): number {
    const distance = Math.hypot(at.x - this.camera.target.x, at.y - this.camera.target.y);
    return Math.max(0, 1 - distance / 700);
  }

  private addShake(magnitude: number): void {
    this.shakeAmplitude = Math.min(9, this.shakeAmplitude + magnitude);
  }

  /**
   * A short real light at the muzzle. Pooled and capped: dynamic lights cost a
   * shader permutation each, and a full alpha strike must not allocate eight.
   */
  private muzzleLight(at: Vec2, colour: number, damage: number): void {
    const idle = this.flashes.find((flash) => flash.ttl <= 0);
    const flash = idle ?? this.newFlash();
    if (flash === null) return;
    flash.ttl = 0.09;
    flash.light.color.setHex(colour);
    flash.light.intensity = 300 + damage * 40;
    flash.light.position.set(at.x, this.terrain.heightAt(at.x, at.y) + 16, at.y);
    flash.light.visible = true;
  }

  private newFlash(): MuzzleFlash | null {
    if (this.flashes.length >= 4) return null;
    const light = new PointLight(0xffffff, 0, 120, 2);
    light.visible = false;
    this.scene.add(light);
    const flash = { light, ttl: 0 };
    this.flashes.push(flash);
    return flash;
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
      this.scene.remove(existing.model.root, existing.ring, existing.hoverRing);
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
      new Set(LOCATIONS.filter((location) => entity.locations[location].destroyed)),
      chassis?.hardpoints,
    );

    const radius = radiusFor(entity.tonnage);
    const ring = new Mesh(
      new RingGeometry(radius * 1.2, radius * 1.42, 28),
      new MeshBasicMaterial({ color: UI.selection, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;

    // Wider than the selection ring and in the hostile colour, so hovering a
    // mech says both "the game can see what you are pointing at" and "clicking
    // here will start a fight".
    const hoverRing = new Mesh(
      new RingGeometry(radius * 1.5, radius * 1.66, 28),
      new MeshBasicMaterial({
        color: entity.team === world.playerTeam ? UI.friendly : UI.hostile,
        transparent: true,
        opacity: 0.85,
      }),
    );
    hoverRing.rotation.x = -Math.PI / 2;
    hoverRing.visible = false;

    model.root.userData.entityId = entity.id;
    this.scene.add(model.root, ring, hoverRing);
    const view: EntityView = { model, signature, ring, hoverRing };
    this.views.set(entity.id, view);
    return view;
  }

  draw(world: World, alpha: number, deltaSeconds: number, view: ViewState): void {
    this.interpolate(world, alpha);
    this.elapsed += deltaSeconds;
    this.jets.begin();

    for (const entity of world.entities) {
      // A wreck is scenery. Sensors stop tracking a machine the moment it
      // dies, but a corpse the player has seen fall should not evaporate —
      // it stays wherever explored ground remembers it.
      const tile = world.terrain.toTile(entity.pos);
      const seen =
        world.vision === null ||
        entity.team === world.vision.team ||
        world.vision.visible.has(entity.id) ||
        (entity.destroyed &&
          tileExplored(world.vision, tile.row * world.terrain.width + tile.column));

      const shown = this.viewFor(world, entity);
      shown.model.root.visible = seen;
      shown.ring.visible = seen && view.selection.has(entity.id) && isOperational(entity);
      shown.hoverRing.visible = seen && view.hovered === entity.id && isOperational(entity);
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
      // Stand the mech on the ground rather than on the idea of the ground: a
      // hull that stays level walking up a scarp is what makes a ridge read as
      // a painted backdrop.
      this.standOnSlope(entity, at);

      this.animate(entity, shown, at, deltaSeconds);
      // After animate(), or the nozzles ride a frame behind the legs.
      if (entity.jump !== null) this.burn(entity, shown);

      shown.ring.position.set(at.x, ground + 1.2, at.y);
      shown.hoverRing.position.set(at.x, ground + 1.1, at.y);
    }

    // The camera flinch: exponential decay, jittered on two incommensurate
    // frequencies so it reads as a shudder rather than a wobble.
    this.shakeTime += deltaSeconds;
    this.shakeAmplitude *= Math.exp(-deltaSeconds * 7);
    if (this.shakeAmplitude < 0.02) this.shakeAmplitude = 0;
    const t = this.shakeTime;
    this.camera.shake.set(
      Math.sin(t * 61) * this.shakeAmplitude,
      Math.sin(t * 47 + 1.3) * this.shakeAmplitude * 0.6,
      Math.cos(t * 53 + 0.7) * this.shakeAmplitude,
    );

    for (const flash of this.flashes) {
      if (flash.ttl <= 0) continue;
      flash.ttl -= deltaSeconds;
      if (flash.ttl <= 0) flash.light.visible = false;
      else flash.light.intensity *= 0.72;
    }

    this.jets.commit();
    this.drawMarkers(world, view);
    this.tracers.update(deltaSeconds);
    this.smoke.update(deltaSeconds);
    this.fog.update(world.terrain, world.vision);
    this.props.update(world.vision);

    const viewport = this.viewport;
    this.camera.advance(deltaSeconds);
    this.camera.update(viewport);
    this.renderer.render(this.scene, this.camera.camera);
  }

  /**
   * The body language on top of the sim's positions: legs that swing and bend
   * with the ground actually covered, a hull that bobs with the stride, and a
   * machine that falls over when it dies instead of just changing colour.
   */
  private animate(entity: MechEntity, view: EntityView, at: Interpolated, dt: number): void {
    const anim = this.animationFor(entity.id);
    const model = view.model;

    // ------------------------------------------------------------ death fall
    if (entity.destroyed) {
      anim.fall = Math.min(1, anim.fall + dt * 1.5);
      const eased = 1 - (1 - anim.fall) ** 2;
      // Falls along its own facing — on its face or its back by id, so a
      // field of wrecks does not look drilled.
      const direction = entity.id % 2 === 0 ? 1 : -1;
      model.root.rotation.z = -eased * 1.22 * direction;
      model.root.position.y -= eased * 1.2;
      if (anim.fall >= 1 && !anim.landedFall) {
        anim.landedFall = true;
        this.tracers.impact(
          { x: at.x, y: at.y },
          this.terrain.heightAt(at.x, at.y) + 2,
          0x8a8a82,
        );
        this.addShake(2.5 * this.nearness(at));
      }
      // A wreck's legs freeze wherever the stride left them.
      return;
    }

    // ------------------------------------------------------- knocked to ground
    // The same pose as the death fall, except it comes back up: `fall` runs
    // down again as the mech gets its feet under it, so standing is the fall in
    // reverse rather than a snap to upright.
    const down = entity.downRemaining > 0;
    anim.fall = Math.max(0, Math.min(1, anim.fall + dt * (down ? 2.2 : -1.8)));
    if (anim.fall > 0) {
      const eased = 1 - (1 - anim.fall) ** 2;
      const direction = entity.id % 2 === 0 ? 1 : -1;
      model.root.rotation.z = -eased * 1.1 * direction;
      model.root.position.y -= eased * 1.05;
      if (down && anim.fall >= 1 && !anim.landedFall) {
        anim.landedFall = true;
        this.tracers.impact({ x: at.x, y: at.y }, this.terrain.heightAt(at.x, at.y) + 2, 0x8a8a82);
        this.addShake(1.8 * this.nearness(at));
      }
      if (!down) anim.landedFall = false;
      // Flat on its back, the stride is not running. On the way up it is, so
      // the legs gather under the mech instead of dragging.
      if (down) return;
    } else {
      model.root.rotation.z = anim.roll;
    }

    // ------------------------------------------------------------ walk cycle
    const moved = anim.lastAt === null ? 0 : Math.hypot(at.x - anim.lastAt.x, at.y - anim.lastAt.y);
    anim.lastAt = { x: at.x, y: at.y };

    // None of what follows belongs to a machine on tracks: no stride to
    // advance, no hull to bob with it, and above all no footfalls. It still
    // tips to the ground it sits on, which is true of anything with weight.
    if (model.legs.length === 0) {
      model.root.rotation.x = anim.pitch;
      return;
    }

    // Phase advances with ground covered, so feet plant against the terrain
    // rather than pedalling at a fixed rate; π of phase is one footstep.
    anim.phase += (moved / Math.max(1, model.strideLength)) * Math.PI;
    const speed = dt > 0 ? moved / dt : 0;
    const wants = speed > 1.5 ? 1 : 0;
    anim.amp += (wants - anim.amp) * Math.min(1, dt * 8);

    const swing = 0.42 * anim.amp;
    model.legs.forEach((leg, index) => {
      const phase = anim.phase + (index === 0 ? 0 : Math.PI);
      leg.hip.rotation.z = Math.sin(phase) * swing;
      // The shin folds as the leg comes through, and lands nearly straight.
      leg.knee.rotation.z = -Math.max(0, Math.sin(phase + 0.9)) * 0.5 * anim.amp;
    });

    // The hull rides the stride: two bobs per cycle, and a touch of roll.
    model.torso.position.y =
      model.torsoRestY + Math.abs(Math.sin(anim.phase)) * model.torsoRestY * 0.035 * anim.amp;
    model.root.rotation.x = anim.pitch + Math.sin(anim.phase) * 0.02 * anim.amp;

    // A footstep lands every π once the stride is actually carrying weight.
    const step = Math.floor(anim.phase / Math.PI);
    if (step !== anim.lastStep) {
      anim.lastStep = step;
      if (anim.amp > 0.4 && this.onFootfall !== null) {
        this.onFootfall({ x: at.x, y: at.y }, entity.tonnage);
      }
    }
  }

  /**
   * Tips the hull to match the ground it is standing on, sampled a stride
   * ahead and to each side rather than under the feet — a mech reads the slope
   * it is walking onto, and sampling a single point makes the pose jitter every
   * time a foot crosses a tile edge.
   *
   * Eased rather than snapped, and capped, because the terrain has step-height
   * scarps in it and a hull lying at 40 degrees reads as a bug.
   */
  private standOnSlope(entity: MechEntity, at: Interpolated): void {
    const anim = this.animationFor(entity.id);
    const reach = 22;

    const ahead = this.terrain.heightAt(
      at.x + Math.cos(at.facing) * reach,
      at.y + Math.sin(at.facing) * reach,
    );
    const behind = this.terrain.heightAt(
      at.x - Math.cos(at.facing) * reach,
      at.y - Math.sin(at.facing) * reach,
    );
    const left = this.terrain.heightAt(
      at.x + Math.cos(at.facing + Math.PI / 2) * reach,
      at.y + Math.sin(at.facing + Math.PI / 2) * reach,
    );
    const right = this.terrain.heightAt(
      at.x + Math.cos(at.facing - Math.PI / 2) * reach,
      at.y + Math.sin(at.facing - Math.PI / 2) * reach,
    );

    const LIMIT = 0.32;
    const wantPitch = Math.max(-LIMIT, Math.min(LIMIT, Math.atan2(ahead - behind, reach * 2)));
    const wantRoll = Math.max(-LIMIT, Math.min(LIMIT, Math.atan2(left - right, reach * 2)));

    anim.pitch += (wantPitch - anim.pitch) * 0.12;
    anim.roll += (wantRoll - anim.roll) * 0.12;
  }

  private animationFor(id: EntityId): AnimationState {
    const existing = this.animation.get(id);
    if (existing !== undefined) return existing;
    const fresh: AnimationState = {
      phase: 0,
      amp: 0,
      lastAt: null,
      lastStep: 0,
      fall: 0,
      pitch: 0,
      roll: 0,
      landedFall: false,
    };
    this.animation.set(id, fresh);
    return fresh;
  }

  private drawMarkers(world: World, view: ViewState): void {
    // These are rebuilt every frame, so their GPU buffers have to be freed by
    // hand — clear() alone drops the references and keeps the buffers, which
    // is a leak of several rings per frame for a whole battle.
    for (const child of this.markers.children) {
      if (child instanceof Mesh || child instanceof Line) {
        child.geometry.dispose();
        (child.material as { dispose(): void }).dispose();
      }
    }
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

      // How far this machine can see, against a hull of average signature.
      // Drawn faintly and always: where the lance's sensor envelope reaches is
      // a standing fact about the position, not something to go and look up.
      this.markers.add(this.groundRing(entity.pos, entity.sensorRange, UI.selection, 0.14));

      // Weapon reach, drawn while the player is lining up an attack so range
      // stops being a number in a panel and becomes a circle on the ground.
      if (
        view.orderMode === 'attack' ||
        view.orderMode === 'attack_move' ||
        view.orderMode === 'called_shot'
      ) {
        const reaches = new Set<number>();
        for (const mount of entity.weapons) {
          if (mount.destroyed) continue;
          const weapon = world.catalog.weapons.get(mount.weaponId);
          if (weapon !== undefined) reaches.add(Math.round(weapon.range.long));
        }
        for (const reach of [...reaches].sort((a, b) => a - b).slice(0, 3)) {
          this.markers.add(this.groundRing(entity.pos, reach, UI.attackMarker, 0.35));
        }
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

  /**
   * The mech under a point on screen.
   *
   * This has to work off the screen, not off the ground. A click that looks
   * like it lands on a mech's chest actually raycasts through to ground well
   * behind its feet, because the camera is tilted and the machine is twenty
   * metres tall — so picking by world distance from that ground point misses
   * the thing the player was obviously pointing at. The hulls themselves are
   * offered to the ray first; failing that, the nearest body centre within a
   * screen-space radius catches a click that grazed the edge.
   */
  entityAtScreen(
    world: World,
    screen: Vec2,
    radiusPixels: number,
    /** Narrows what counts as a hit, so a caller can look only for hostiles. */
    wanted: (entity: MechEntity) => boolean = () => true,
  ): MechEntity | null {
    const viewport = this.viewport;
    const visible = (entity: MechEntity): boolean =>
      (world.vision === null ||
        entity.team === world.vision.team ||
        world.vision.visible.has(entity.id)) &&
      wanted(entity);

    const roots = world.entities
      .filter((entity) => visible(entity) && isOperational(entity))
      .map((entity) => this.views.get(entity.id)?.model.root)
      .filter((root): root is Group => root !== undefined && root.visible);

    const hit = this.camera.pick(screen, viewport, roots);
    if (hit !== null) {
      const id = hit.userData.entityId as EntityId | undefined;
      const found = world.entities.find((entity) => entity.id === id);
      if (found !== undefined) return found;
    }

    let best: MechEntity | null = null;
    let bestRange = radiusPixels;
    for (const entity of world.entities) {
      if (!visible(entity)) continue;
      const at = this.interpolated.get(entity.id) ?? entity.pos;
      const body = this.camera.worldToScreen(
        at,
        viewport,
        this.terrain.heightAt(at.x, at.y) + radiusFor(entity.tonnage),
      );
      const range = Math.hypot(body.x - screen.x, body.y - screen.y);
      if (range < bestRange) {
        best = entity;
        bestRange = range;
      }
    }

    return best;
  }

  /**
   * Lights the jets under a mech that is in the air. Throttle is read off how
   * far through the arc it is: hard on the pads to get off the ground, cut over
   * the top, relit to cushion the landing — the burn a pilot would actually fly.
   */
  private burn(entity: MechEntity, shown: EntityView): void {
    const jump = entity.jump;
    if (jump === null) return;

    const progress = jump.duration <= 0 ? 1 : jump.elapsed / jump.duration;
    const throttle = Math.min(
      1,
      Math.max(0, 1 - progress * 2.4) + Math.max(0, (progress - 0.7) / 0.3) * 0.8,
    );
    if (throttle <= 0.02) return;

    shown.model.legs.forEach((rig, leg) => {
      // getWorldPosition updates the chain itself, so this is correct even
      // though the renderer has not run its own matrix pass yet this frame.
      rig.knee.getWorldPosition(NOZZLE);
      this.jets.plume(entity.id * 2 + leg, NOZZLE, throttle, this.elapsed);
    });
  }

  spawnSmoke(at: Vec2): void {
    this.tracers.spawnSmoke(at, this.terrain.heightAt(at.x, at.y));
  }

  teamTint(team: number): number {
    return teamColour(team);
  }
}
