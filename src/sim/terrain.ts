import type { TerrainMapData } from '../schema/map';
import type { TerrainRules, TerrainType } from '../schema/rules';
import type { Vec2 } from './types';

export interface TileRef {
  column: number;
  row: number;
}

export interface TerrainGrid {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly minStepCost: number;
  typeAt(column: number, row: number): TerrainType;
  typeAtPoint(point: Vec2): TerrainType;
  elevationAt(column: number, row: number): number;
  passable(column: number, row: number): boolean;
  inBounds(column: number, row: number): boolean;
  toTile(point: Vec2): TileRef;
  tileCentre(column: number, row: number): Vec2;
}

const OFF_MAP: TerrainType = {
  moveMultiplier: 0,
  coverFactor: 1,
  losObstruction: 1,
  heatDissipationMultiplier: 1,
  passable: false,
};

export function createTerrainGrid(data: TerrainMapData, rules: TerrainRules): TerrainGrid {
  const cells: TerrainType[] = new Array<TerrainType>(data.width * data.height);
  const elevations = new Uint8Array(data.width * data.height);

  for (let row = 0; row < data.height; row += 1) {
    const tileRow = data.tiles[row] ?? '';
    const elevationRow = data.elevation?.[row];
    for (let column = 0; column < data.width; column += 1) {
      const symbol = tileRow[column] ?? '';
      const terrainId = data.legend[symbol];
      const terrain = terrainId === undefined ? undefined : rules.types[terrainId];
      cells[row * data.width + column] = terrain ?? OFF_MAP;
      elevations[row * data.width + column] = Number(elevationRow?.[column] ?? '0');
    }
  }

  let minStepCost = Number.POSITIVE_INFINITY;
  for (const terrain of Object.values(rules.types)) {
    if (!terrain.passable || terrain.moveMultiplier <= 0) continue;
    minStepCost = Math.min(minStepCost, 1 / terrain.moveMultiplier);
  }
  if (!Number.isFinite(minStepCost)) minStepCost = 1;

  const inBounds = (column: number, row: number): boolean =>
    column >= 0 && row >= 0 && column < data.width && row < data.height;

  const typeAt = (column: number, row: number): TerrainType =>
    inBounds(column, row) ? (cells[row * data.width + column] ?? OFF_MAP) : OFF_MAP;

  return {
    id: data.id,
    width: data.width,
    height: data.height,
    tileSize: data.tileSize,
    minStepCost,
    typeAt,
    typeAtPoint: (point) =>
      typeAt(Math.floor(point.x / data.tileSize), Math.floor(point.y / data.tileSize)),
    elevationAt: (column, row) =>
      inBounds(column, row) ? (elevations[row * data.width + column] ?? 0) : 0,
    passable: (column, row) => {
      const terrain = typeAt(column, row);
      return terrain.passable && terrain.moveMultiplier > 0;
    },
    inBounds,
    toTile: (point) => ({
      column: Math.floor(point.x / data.tileSize),
      row: Math.floor(point.y / data.tileSize),
    }),
    tileCentre: (column, row) => ({
      x: (column + 0.5) * data.tileSize,
      y: (row + 0.5) * data.tileSize,
    }),
  };
}
