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
  /**
   * Contacts close enough to be told apart. Everything in `visible` is a
   * return on somebody's scope; only these are a machine the lance can name.
   */
  identified: Set<EntityId>;
  ghosts: Map<EntityId, Ghost>;
  tiles: Uint8Array;
  explored: Uint8Array;
}

export function sensorRangeFor(rules: SensorRules, sensorSkill: number): number {
  return rules.baseRange + rules.rangePerSkill * sensorSkill;
}

/**
 * How loud a hull is, as a multiplier on whoever is looking for it. Mass is
 * most of it: a hundred tonnes of reactor and hot plate is a beacon, and a
 * scout is worth fielding because it has to be walked up on.
 */
export function signatureFor(rules: SensorRules, tonnage: number): number {
  return rules.signatureBase + rules.signaturePerTon * tonnage;
}

export function createVision(world: World, team: number): TeamVision {
  const cells = world.terrain.width * world.terrain.height;
  return {
    team,
    visible: new Set(),
    identified: new Set(),
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
  vision.identified.clear();

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

  const identifyFraction = world.rules.sensors.identifyFraction;

  for (const candidate of world.entities) {
    if (candidate.team === vision.team || !isOperational(candidate)) continue;

    // How near this particular machine has to be before it registers. A big
    // hull is picked up across the map; a scout has to be walked up on.
    //
    // Where it is standing counts too, and counts separately: signature is a
    // property of the machine and travels with it, while a treeline is left
    // behind the moment the mech walks out from under it.
    const concealment = world.terrain.typeAtPoint(candidate.pos).signatureFactor;

    let closest = Infinity;
    for (const observer of observers) {
      const reach = observer.sensorRange * candidate.signature * concealment;
      const gap = distance(observer.pos, candidate.pos);
      if (gap > reach) continue;
      if (!lineOfSight(world.terrain, observer.pos, candidate.pos).clear) continue;
      closest = Math.min(closest, gap / reach);
    }

    // An overflight reports what it sees, and reports it clearly: nobody is
    // squinting through terrain on a sensor sweep.
    const swept = sweeps.some(
      (sweep) => distance(candidate.pos, { x: sweep.x, y: sweep.y }) <= sweep.radius,
    );
    if (swept) closest = Math.min(closest, 0);

    if (closest === Infinity) continue;

    vision.visible.add(candidate.id);
    if (closest <= identifyFraction) vision.identified.add(candidate.id);
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

/** Whether the lance can name what it is looking at, or only that it is there. */
export function isIdentifiedBy(vision: TeamVision | null, entity: MechEntity): boolean {
  if (vision === null) return true;
  if (entity.team === vision.team) return true;
  return vision.identified.has(entity.id);
}

export function tileVisible(vision: TeamVision | null, cell: number): boolean {
  if (vision === null) return true;
  return vision.tiles[cell] === 1;
}

export function tileExplored(vision: TeamVision | null, cell: number): boolean {
  if (vision === null) return true;
  return vision.explored[cell] === 1;
}
