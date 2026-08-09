import type { SensorRules } from '../schema/rules';
import { lineOfSight } from './los';
import { distance } from './math';
import { isOperational, type EntityId, type MechEntity, type Vec2, type World } from './types';

export interface Ghost {
  pos: Vec2;
  tick: number;
  team: number;
}

export interface TeamVision {
  team: number;
  visible: Set<EntityId>;
  ghosts: Map<EntityId, Ghost>;
  tiles: Uint8Array;
  explored: Uint8Array;
}

export function sensorRangeFor(rules: SensorRules, sensorSkill: number): number {
  return rules.baseRange + rules.rangePerSkill * sensorSkill;
}

export function createVision(world: World, team: number): TeamVision {
  const cells = world.terrain.width * world.terrain.height;
  return {
    team,
    visible: new Set(),
    ghosts: new Map(),
    tiles: new Uint8Array(cells),
    explored: new Uint8Array(cells),
  };
}

function markTiles(world: World, vision: TeamVision, at: Vec2, range: number): void {
  const { terrain } = world;
  const radius = Math.ceil(range / terrain.tileSize);
  const centre = terrain.toTile(at);

  for (let row = centre.row - radius; row <= centre.row + radius; row += 1) {
    for (let column = centre.column - radius; column <= centre.column + radius; column += 1) {
      if (!terrain.inBounds(column, row)) continue;
      if (distance(at, terrain.tileCentre(column, row)) > range) continue;
      const cell = row * terrain.width + column;
      vision.tiles[cell] = 1;
      vision.explored[cell] = 1;
    }
  }
}

export function updateVision(world: World, vision: TeamVision): void {
  vision.tiles.fill(0);
  vision.visible.clear();

  const observers = world.entities.filter(
    (entity) => entity.team === vision.team && isOperational(entity),
  );

  for (const observer of observers) {
    markTiles(world, vision, observer.pos, observer.sensorRange);
  }

  // A sensor probe, or a scripted recon sweep, looks at the ground from above:
  // there is no observer standing on the field and no ridge to break the line.
  const sweeps = world.reveals.filter((reveal) => reveal.team === vision.team);
  for (const sweep of sweeps) {
    markTiles(world, vision, { x: sweep.x, y: sweep.y }, sweep.radius);
  }

  for (const candidate of world.entities) {
    if (candidate.team === vision.team || !isOperational(candidate)) continue;

    const spotted =
      observers.some(
        (observer) =>
          distance(observer.pos, candidate.pos) <= observer.sensorRange &&
          lineOfSight(world.terrain, observer.pos, candidate.pos).clear,
      ) ||
      sweeps.some((sweep) => distance(candidate.pos, { x: sweep.x, y: sweep.y }) <= sweep.radius);

    if (!spotted) continue;

    vision.visible.add(candidate.id);
    vision.ghosts.set(candidate.id, {
      pos: { x: candidate.pos.x, y: candidate.pos.y },
      tick: world.tick,
      team: candidate.team,
    });
  }

  const memoryTicks = world.rules.sensors.ghostMemorySeconds / world.dt;
  for (const [id, ghost] of vision.ghosts) {
    if (world.tick - ghost.tick > memoryTicks) vision.ghosts.delete(id);
  }
}

export function isVisibleTo(vision: TeamVision | null, entity: MechEntity): boolean {
  if (vision === null) return true;
  if (entity.team === vision.team) return true;
  return vision.visible.has(entity.id);
}

export function tileVisible(vision: TeamVision | null, cell: number): boolean {
  if (vision === null) return true;
  return vision.tiles[cell] === 1;
}

export function tileExplored(vision: TeamVision | null, cell: number): boolean {
  if (vision === null) return true;
  return vision.explored[cell] === 1;
}
