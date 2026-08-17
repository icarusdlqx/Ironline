import {
  ACESFilmicToneMapping,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Atmosphere } from '../schema/atmosphere';
import type { TerrainMapData } from '../schema/map';
import type { SimEvent } from '../sim/events';
import { jumpHeight } from '../sim/movement';
import { tileExplored } from '../sim/sensors';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../sim/types';
import { teamColour } from '../render/palette';
import { radiusFor } from '../render/shape';
import { buildAtmosphereRig, surroundColour } from './atmosphere';
import { BattleEffects } from './battleEffects';
import { TacticalCamera, type Viewport } from './camera';
import { FogLayer } from './fog';
import { Locomotion } from './locomotion';
import { MarkerLayer, type MarkerViewState } from './markerLayer';
import { PropLayer } from './props';
import { buildTerrain, type TerrainMesh } from './terrain';
import { UnitViews } from './unitViews';

export interface ViewState extends MarkerViewState {
  hovered: EntityId | null;
  cursor: Vec2 | null;
  selectionBox: { a: Vec2; b: Vec2 } | null;
  supportRun: { at: Vec2; heading: number; length: number; width: number } | null;
}

function readLowFx(): boolean {
  try {
    return localStorage.getItem('ironline.lowfx') === '1';
  } catch {
    return false;
  }
}

/** The battlefield facade; specialised layers own models, gait, effects and markers. */
export class Renderer {
  readonly camera = new TacticalCamera();
  readonly scene = new Scene();
  readonly mapData: TerrainMapData;

  private readonly renderer: WebGLRenderer;
  private readonly terrain: TerrainMesh;
  private readonly props: PropLayer;
  private readonly fog: FogLayer;
  private readonly units: UnitViews;
  private readonly effects: BattleEffects;
  private readonly locomotion: Locomotion;
  private readonly markers: MarkerLayer;
  private readonly host: HTMLElement;
  private visionTick = -1;

  lowFx = readLowFx();

  constructor(host: HTMLElement, world: World, mapData: TerrainMapData, atmosphere: Atmosphere) {
    this.mapData = mapData;
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.lowFx ? 1 : Math.min(1.5, globalThis.devicePixelRatio ?? 1));
    this.renderer.shadowMap.enabled = !this.lowFx;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;

    const mapWidth = world.terrain.width * world.terrain.tileSize;
    const mapHeight = world.terrain.height * world.terrain.tileSize;
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

    const surround = new Mesh(
      new PlaneGeometry(mapWidth * 9, mapHeight * 9),
      new MeshBasicMaterial({ color: surroundColour(rig) }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(mapWidth / 2, -3, mapHeight / 2);
    this.scene.add(surround);

    this.fog = new FogLayer(world.terrain, this.terrain.heightAt);
    this.scene.add(this.fog.mesh);
    this.units = new UnitViews(this.scene, this.terrain.heightAt);
    this.effects = new BattleEffects(
      this.scene,
      surroundColour(rig),
      this.camera,
      this.terrain.heightAt,
      (id) => this.units.positionOf(id),
    );
    this.locomotion = new Locomotion(
      this.terrain.heightAt,
      (at) => this.terrainAt(at),
      this.effects,
    );
    this.markers = new MarkerLayer(this.terrain.heightAt, (id) => this.units.positionOf(id));
    this.scene.add(this.markers.group);

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
    this.camera.beginDropIn();
    this.resize();
    this.snapshot(world);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get viewport(): Viewport {
    return { width: this.host.clientWidth || 1, height: this.host.clientHeight || 1 };
  }

  get groundMesh(): Mesh {
    return this.terrain.mesh;
  }

  get onFootfall(): ((at: Vec2, tonnage: number) => void) | null {
    return this.locomotion.onFootfall;
  }

  set onFootfall(callback: ((at: Vec2, tonnage: number) => void) | null) {
    this.locomotion.onFootfall = callback;
  }

  setLowFx(low: boolean): void {
    this.lowFx = low;
    try {
      localStorage.setItem('ironline.lowfx', low ? '1' : '0');
    } catch {
      // Private browsing; the preference lasts for the session.
    }
    this.renderer.shadowMap.enabled = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(1.5, globalThis.devicePixelRatio ?? 1));
    this.resize();
    this.scene.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.material === undefined) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.needsUpdate = true;
    });
  }

  resize(): void {
    const { width, height } = this.viewport;
    this.renderer.setSize(width, height);
    this.camera.update({ width, height });
  }

  destroy(): void {
    this.units.dispose();
    this.markers.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  snapshot(world: World): void {
    this.units.snapshot(world);
  }

  consumeEvents(world: World, events: readonly SimEvent[]): void {
    this.effects.consume(world, events);
  }

  draw(world: World, alpha: number, deltaSeconds: number, view: ViewState): void {
    this.units.interpolate(world, alpha);
    this.effects.beginFrame(deltaSeconds);

    for (const entity of world.entities) {
      const tile = world.terrain.toTile(entity.pos);
      const seen =
        world.vision === null ||
        entity.team === world.vision.team ||
        world.vision.visible.has(entity.id) ||
        (entity.destroyed &&
          tileExplored(world.vision, tile.row * world.terrain.width + tile.column));

      const shown = this.units.viewFor(world, entity);
      shown.model.root.visible = seen;
      shown.ring.visible = seen && view.selection.has(entity.id) && isOperational(entity);
      shown.hoverRing.visible = seen && view.hovered === entity.id && isOperational(entity);
      if (!seen) continue;

      const at = this.units.at(entity);
      const ground = this.terrain.heightAt(at.x, at.y);
      const lift = jumpHeight(entity) * radiusFor(entity.tonnage) * 2.2;
      this.locomotion.place(entity, shown.model, at, lift, deltaSeconds);

      shown.ring.position.set(at.x, ground + 1.2, at.y);
      shown.hoverRing.position.set(at.x, ground + 1.1, at.y);
    }

    this.effects.finishFrame(deltaSeconds);
    this.markers.draw(world, view);
    if (world.tick !== this.visionTick) {
      this.visionTick = world.tick;
      this.fog.update(world.terrain, world.vision);
      this.props.update(world.vision);
    }

    this.camera.advance(deltaSeconds);
    this.camera.update(this.viewport);
    this.renderer.render(this.scene, this.camera.camera);
  }

  positionOf(id: EntityId): Vec2 | null {
    return this.units.positionOf(id);
  }

  screenBodyOf(entity: MechEntity): { x: number; y: number; radius: number } {
    return this.units.screenBodyOf(entity, this.camera, this.viewport);
  }

  entityAtScreen(
    world: World,
    screen: Vec2,
    radiusPixels: number,
    wanted: (entity: MechEntity) => boolean = () => true,
  ): MechEntity | null {
    return this.units.entityAtScreen(
      world,
      screen,
      radiusPixels,
      this.camera,
      this.viewport,
      wanted,
    );
  }

  spawnSmoke(at: Vec2): void {
    this.effects.spawnSmoke(at);
  }

  teamTint(team: number): number {
    return teamColour(team);
  }

  private terrainAt(at: Vec2): string {
    const column = Math.max(0, Math.min(this.mapData.width - 1, Math.floor(at.x / this.mapData.tileSize)));
    const row = Math.max(0, Math.min(this.mapData.height - 1, Math.floor(at.y / this.mapData.tileSize)));
    return this.mapData.legend[this.mapData.tiles[row]?.[column] ?? ''] ?? 'open';
  }
}
