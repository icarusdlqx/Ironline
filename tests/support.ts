import { loadCatalog } from '../src/schema/load';
import type { TerrainMapData } from '../src/schema/map';
import { createMech } from '../src/sim/entity';
import { createTerrainGrid, type TerrainGrid } from '../src/sim/terrain';
import type { MechEntity, World } from '../src/sim/types';
import { createWorld } from '../src/sim/world';

export const catalog = loadCatalog();

export function testWorld(seed: string = 'test'): World {
  return createWorld(catalog, { seed, missionId: 'skirmish_ridge' });
}

export function playerWorld(seed: string = 'test', playerTeam: number = 0): World {
  return createWorld(catalog, { seed, missionId: 'skirmish_ridge', playerTeam });
}

/** Drops an extra mech into a running world, for designs no mission fields. */
export function spawnDesign(
  world: World,
  designId: string,
  team: number = 1,
  spawn: { x: number; y: number } = { x: 480, y: 480 },
): MechEntity {
  const entity = createMech(catalog, catalog.rules, {
    id: Math.max(0, ...world.entities.map((other) => other.id)) + 1,
    team,
    designId,
    pilotId: 'nadia_ostrow',
    spawn,
    facingDegrees: 0,
  });
  world.entities.push(entity);
  return entity;
}

export function unitOf(world: World, designId: string): MechEntity {
  const entity = world.entities.find((candidate) => candidate.designId === designId);
  if (entity === undefined) throw new Error(`no unit with design "${designId}" in this mission`);
  return entity;
}

export interface GridSpec {
  tiles: string[];
  legend: Record<string, string>;
  elevation?: string[];
  tileSize?: number;
}

export function makeGrid(spec: GridSpec): TerrainGrid {
  const height = spec.tiles.length;
  const width = spec.tiles[0]?.length ?? 0;

  const data: TerrainMapData = {
    id: 'test_grid',
    name: 'Test Grid',
    tileSize: spec.tileSize ?? 10,
    width,
    height,
    legend: spec.legend,
    tiles: spec.tiles,
    atmosphereId: 'overcast_day',
    ...(spec.elevation === undefined ? {} : { elevation: spec.elevation }),
  };

  return createTerrainGrid(data, catalog.rules.terrain);
}

export const OPEN_LEGEND = { '.': 'open', '#': 'impassable', f: 'forest', b: 'building' };
