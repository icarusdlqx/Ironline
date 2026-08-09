import { Application, Container, Graphics } from 'pixi.js';
import type { TerrainMapData } from '../schema/map';
import type { SimEvent } from '../sim/events';
import { angleDifference, normaliseAngle } from '../sim/math';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from '../sim/types';
import { Camera } from './camera';
import { EffectLayer } from './effects';
import { FogLayer } from './fog';
import { MechLayer, type Interpolated } from './mechs';
import { teamColour, UI } from './palette';
import { buildTilemap } from './tilemap';

export interface ViewState {
  selection: ReadonlySet<EntityId>;
  hovered: EntityId | null;
  cursor: Vec2 | null;
  selectionBox: { a: Vec2; b: Vec2 } | null;
  orderMode: 'move' | 'run' | 'attack' | 'called_shot' | null;
}

interface MotionSample {
  prev: Interpolated;
  cur: Interpolated;
}

export class Renderer {
  readonly camera = new Camera();
  readonly world: Container = new Container();

  private readonly mechs = new MechLayer();
  private readonly effects = new EffectLayer();
  private readonly fog = new FogLayer();
  private readonly markers = new Graphics();
  private readonly samples = new Map<EntityId, MotionSample>();
  private readonly interpolated = new Map<EntityId, Interpolated>();

  constructor(
    private readonly app: Application,
    world: World,
    mapData: TerrainMapData,
  ) {
    this.world.addChild(buildTilemap(world.terrain, mapData));
    this.world.addChild(this.markers);
    this.world.addChild(this.mechs.container);
    this.world.addChild(this.effects.graphics);
    this.world.addChild(this.fog.graphics);

    this.app.stage.addChild(this.world);

    this.camera.setBounds(
      world.terrain.width * world.terrain.tileSize,
      world.terrain.height * world.terrain.tileSize,
    );

    const lance = world.entities.filter((entity) => entity.team === (world.playerTeam ?? 0));
    const centroid = lance.reduce(
      (sum, entity) => ({
        x: sum.x + entity.pos.x / lance.length,
        y: sum.y + entity.pos.y / lance.length,
      }),
      { x: 0, y: 0 },
    );
    this.camera.centreOn(lance.length === 0 ? { x: 0, y: 0 } : centroid);
    this.camera.zoom = 1.1;

    this.snapshot(world);
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
    this.effects.spawnFromEvents(
      events,
      (id) => this.positionOf(id),
      (weaponId) => {
        const weapon = world.catalog.weapons.get(weaponId);
        if (weapon === undefined) return null;
        return {
          style: weapon.visual.style,
          colour: parseInt(weapon.visual.colour.slice(1), 16),
          width: weapon.visual.width,
          arc: weapon.visual.arc,
          projectiles: weapon.projectiles,
        };
      },
      (weaponId, from, to) => {
        const velocity = world.catalog.weapons.get(weaponId)?.velocity;
        if (velocity === undefined || velocity === null) return 0.1;
        return Math.hypot(to.x - from.x, to.y - from.y) / velocity;
      },
    );
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

  private drawZones(world: World): void {
    for (const zone of world.zones) {
      const colour = zone.owner === null ? UI.ghost : teamColour(zone.owner);
      this.markers
        .circle(zone.x, zone.y, zone.radius)
        .fill({ color: colour, alpha: zone.contested ? 0.14 : 0.08 })
        .stroke({ width: 2, color: colour, alpha: 0.7 });

      if (zone.contender !== null && zone.progress > 0) {
        const sweep = (zone.progress / zone.captureSeconds) * Math.PI * 2;
        this.markers
          .moveTo(zone.x, zone.y)
          .arc(zone.x, zone.y, zone.radius * 0.72, -Math.PI / 2, -Math.PI / 2 + sweep)
          .lineTo(zone.x, zone.y)
          .fill({ color: teamColour(zone.contender), alpha: 0.3 });
      }
    }

    for (const reveal of world.reveals) {
      this.markers
        .circle(reveal.x, reveal.y, reveal.radius)
        .stroke({ width: 1.5, color: UI.selection, alpha: 0.35 });
    }

    for (const pending of world.support.pending) {
      this.markers
        .circle(pending.target.x, pending.target.y, 26)
        .stroke({ width: 2, color: UI.attackMarker, alpha: 0.85 });
      this.markers
        .circle(pending.target.x, pending.target.y, 8)
        .fill({ color: UI.attackMarker, alpha: 0.6 });
    }

    for (const field of world.support.minefields) {
      this.markers
        .circle(field.pos.x, field.pos.y, field.radius)
        .stroke({ width: 1.5, color: UI.explosion, alpha: 0.5 });
    }

    for (const truck of world.support.trucks) {
      this.markers
        .circle(truck.pos.x, truck.pos.y, truck.radius)
        .stroke({ width: 1.5, color: 0x7fe08c, alpha: 0.6 });
    }
  }

  private drawMarkers(world: World, view: ViewState): void {
    this.markers.clear();
    this.drawZones(world);

    for (const entity of world.entities) {
      if (!view.selection.has(entity.id) || !isOperational(entity)) continue;

      const at = this.interpolated.get(entity.id) ?? {
        x: entity.pos.x,
        y: entity.pos.y,
        facing: entity.facing,
        torso: entity.torsoOffset,
      };

      this.markers
        .circle(at.x, at.y, entity.sensorRange)
        .stroke({ width: 1, color: UI.selection, alpha: 0.18 });

      const halfArc = (world.rules.combat.firingArcDegrees / 2) * (Math.PI / 180);
      const arcRadius = 90;
      const aim = at.facing + at.torso;
      this.markers
        .moveTo(at.x, at.y)
        .arc(at.x, at.y, arcRadius, aim - halfArc, aim + halfArc)
        .lineTo(at.x, at.y)
        .fill({ color: UI.selection, alpha: 0.07 });

      // How far the torso is wound off the hull, and which way it can still swing.
      const twistLimit = world.rules.movement.torsoTwistDegrees * (Math.PI / 180);
      this.markers
        .arc(at.x, at.y, arcRadius * 0.5, at.facing - twistLimit, at.facing + twistLimit)
        .stroke({ width: 1, color: UI.selection, alpha: 0.2 });
      this.markers
        .moveTo(at.x, at.y)
        .lineTo(at.x + Math.cos(aim) * arcRadius * 0.5, at.y + Math.sin(aim) * arcRadius * 0.5)
        .stroke({ width: 2, color: UI.selection, alpha: 0.55 });

      if (entity.path.length > 0) {
        this.markers.moveTo(at.x, at.y);
        for (let index = entity.pathIndex; index < entity.path.length; index += 1) {
          const point = entity.path[index];
          if (point !== undefined) this.markers.lineTo(point.x, point.y);
        }
        this.markers.stroke({ width: 2, color: UI.moveMarker, alpha: 0.55 });
      }

      const order = entity.orders.move;
      if (order !== null) {
        this.markers
          .circle(order.to.x, order.to.y, 7)
          .stroke({ width: 2, color: UI.moveMarker, alpha: 0.9 });
      }

      const attack = world.entities.find((other) => other.id === entity.orders.attack?.targetId);
      if (attack !== undefined && isOperational(attack)) {
        const to = this.interpolated.get(attack.id) ?? attack.pos;
        this.markers
          .moveTo(at.x, at.y)
          .lineTo(to.x, to.y)
          .stroke({ width: 1.5, color: UI.attackMarker, alpha: 0.5 });
        this.markers.circle(to.x, to.y, 20).stroke({ width: 2, color: UI.attackMarker, alpha: 0.9 });
      }
    }

    const box = view.selectionBox;
    if (box !== null) {
      const x = Math.min(box.a.x, box.b.x);
      const y = Math.min(box.a.y, box.b.y);
      this.markers
        .rect(x, y, Math.abs(box.b.x - box.a.x), Math.abs(box.b.y - box.a.y))
        .fill({ color: UI.selection, alpha: 0.08 })
        .stroke({ width: 1.5, color: UI.selection, alpha: 0.75 });
    }

    if (view.cursor !== null && view.orderMode !== null && view.selection.size > 0) {
      const colour = view.orderMode === 'move' || view.orderMode === 'run'
        ? UI.moveMarker
        : UI.attackMarker;
      this.markers
        .circle(view.cursor.x, view.cursor.y, 10)
        .stroke({ width: 1.5, color: colour, alpha: 0.8 });
    }
  }

  draw(world: World, alpha: number, deltaSeconds: number, view: ViewState): void {
    this.interpolate(world, alpha);

    const visible = (entity: MechEntity): boolean => {
      if (world.vision === null) return true;
      if (entity.team === world.vision.team) return true;
      return world.vision.visible.has(entity.id);
    };

    this.effects.update(deltaSeconds);

    this.drawMarkers(world, view);
    this.mechs.draw(
      world.entities,
      this.interpolated,
      visible,
      view.selection,
      (chassisId) => world.catalog.chassis.get(chassisId)?.silhouette,
      (weaponId) => {
        const weapon = world.catalog.weapons.get(weaponId);
        return weapon === undefined
          ? undefined
          : { type: weapon.type, tonnage: weapon.tonnage };
      },
      world.playerTeam ?? 0,
      deltaSeconds,
    );

    if (world.vision !== null) {
      for (const [id, ghost] of world.vision.ghosts) {
        if (world.vision.visible.has(id)) continue;
        this.mechs.drawGhost(ghost.pos.x, ghost.pos.y, ghost.team);
      }
    }

    this.effects.draw();
    this.fog.update(world.terrain, world.vision, world.tick);

    this.camera.applyTo(this.world, {
      width: this.app.screen.width,
      height: this.app.screen.height,
    });
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
    this.effects.spawnSmoke(at);
  }

  teamTint(team: number): number {
    return teamColour(team);
  }
}
