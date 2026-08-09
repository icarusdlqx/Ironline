import { Container, Graphics } from 'pixi.js';
import type { TerrainMapData } from '../schema/map';
import type { TerrainGrid } from '../sim/terrain';
import { shade, TERRAIN_COLOURS } from './palette';

const ELEVATION_LIFT = 0.16;

/** Deterministic per-tile hash. The same map draws the same rocks every load. */
function hash(column: number, row: number, salt: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

interface Tile {
  terrainId: string;
  elevation: number;
}

function readTiles(grid: TerrainGrid, data: TerrainMapData): Tile[][] {
  const tiles: Tile[][] = [];
  for (let row = 0; row < grid.height; row += 1) {
    const symbols = data.tiles[row] ?? '';
    const line: Tile[] = [];
    for (let column = 0; column < grid.width; column += 1) {
      line.push({
        terrainId: data.legend[symbols[column] ?? ''] ?? 'open',
        elevation: grid.elevationAt(column, row),
      });
    }
    tiles.push(line);
  }
  return tiles;
}

function terrainAt(tiles: Tile[][], column: number, row: number): string {
  return tiles[row]?.[column]?.terrainId ?? 'open';
}

function colourFor(terrainId: string): number {
  return TERRAIN_COLOURS[terrainId] ?? TERRAIN_COLOURS.open ?? 0x2f3a2c;
}

/** Ground plus a scatter of tone patches, so no two tiles read as the same block. */
function paintGround(
  ground: Graphics,
  tiles: Tile[][],
  grid: TerrainGrid,
  column: number,
  row: number,
): void {
  const size = grid.tileSize;
  const x = column * size;
  const y = row * size;
  const tile = tiles[row]?.[column];
  if (tile === undefined) return;

  const base = shade(colourFor(tile.terrainId), 1 + tile.elevation * ELEVATION_LIFT);
  ground.rect(x, y, size, size).fill({ color: base });

  // Two soft patches per tile break the grid up without costing a texture.
  for (let index = 0; index < 2; index += 1) {
    const n = hash(column, row, index * 3 + 1);
    const tone = shade(base, 0.9 + n * 0.24);
    const radius = size * (0.18 + hash(column, row, index + 7) * 0.22);
    ground
      .circle(
        x + size * (0.2 + hash(column, row, index + 11) * 0.6),
        y + size * (0.2 + hash(column, row, index + 13) * 0.6),
        radius,
      )
      .fill({ color: tone, alpha: 0.32 });
  }
}

/** Feathers the seam between two different terrains so the map stops looking tiled. */
function blendEdges(
  ground: Graphics,
  tiles: Tile[][],
  grid: TerrainGrid,
  column: number,
  row: number,
): void {
  const size = grid.tileSize;
  const here = terrainAt(tiles, column, row);
  const neighbours: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const [dx, dy] of neighbours) {
    const other = terrainAt(tiles, column + dx, row + dy);
    if (other === here) continue;

    const colour = colourFor(other);
    for (let index = 0; index < 3; index += 1) {
      const along = (index + 0.5) / 3;
      const jut = size * (0.12 + hash(column + dx * 5, row + dy * 5, index) * 0.2);
      const cx = column * size + size * (0.5 + dx * 0.5) + (dx === 0 ? size * (along - 0.5) : 0);
      const cy = row * size + size * (0.5 + dy * 0.5) + (dy === 0 ? size * (along - 0.5) : 0);
      ground.circle(cx, cy, jut).fill({ color: colour, alpha: 0.55 });
    }
  }
}

function paintFeatures(
  features: Graphics,
  tiles: Tile[][],
  grid: TerrainGrid,
  column: number,
  row: number,
): void {
  const size = grid.tileSize;
  const x = column * size;
  const y = row * size;
  const tile = tiles[row]?.[column];
  if (tile === undefined) return;

  switch (tile.terrainId) {
    case 'forest': {
      const count = 3 + Math.floor(hash(column, row, 21) * 3);
      for (let index = 0; index < count; index += 1) {
        const cx = x + size * (0.15 + hash(column, row, index + 31) * 0.7);
        const cy = y + size * (0.15 + hash(column, row, index + 41) * 0.7);
        const r = size * (0.11 + hash(column, row, index + 51) * 0.07);
        features.circle(cx + r * 0.3, cy + r * 0.35, r).fill({ color: 0x000000, alpha: 0.3 });
        features.circle(cx, cy, r).fill({ color: 0x244326, alpha: 0.95 });
        features.circle(cx - r * 0.25, cy - r * 0.3, r * 0.5).fill({ color: 0x365c33, alpha: 0.8 });
      }
      return;
    }

    case 'rough': {
      const count = 2 + Math.floor(hash(column, row, 61) * 3);
      for (let index = 0; index < count; index += 1) {
        const cx = x + size * (0.2 + hash(column, row, index + 71) * 0.6);
        const cy = y + size * (0.2 + hash(column, row, index + 81) * 0.6);
        const r = size * (0.07 + hash(column, row, index + 91) * 0.08);
        features
          .poly([cx - r, cy + r * 0.6, cx - r * 0.4, cy - r, cx + r * 0.8, cy - r * 0.3, cx + r * 0.5, cy + r])
          .fill({ color: 0x6a6152, alpha: 0.85 });
        features
          .poly([cx - r * 0.4, cy - r, cx + r * 0.8, cy - r * 0.3, cx, cy - r * 0.1])
          .fill({ color: 0x8a8172, alpha: 0.7 });
      }
      return;
    }

    case 'water': {
      for (let index = 0; index < 3; index += 1) {
        const wy = y + size * (0.25 + index * 0.25);
        const wx = x + size * (0.1 + hash(column, row, index + 101) * 0.3);
        features
          .moveTo(wx, wy)
          .lineTo(wx + size * (0.25 + hash(column, row, index + 111) * 0.3), wy)
          .stroke({ width: Math.max(1, size * 0.05), color: 0x8fc6e8, alpha: 0.28 });
      }
      return;
    }

    case 'building': {
      const inset = size * 0.12;
      features
        .rect(x + inset + size * 0.05, y + inset + size * 0.05, size - inset * 2, size - inset * 2)
        .fill({ color: 0x000000, alpha: 0.35 });
      features
        .rect(x + inset, y + inset, size - inset * 2, size - inset * 2)
        .fill({ color: 0x6b6660 })
        .stroke({ width: 1, color: 0x2a2825, alpha: 0.9 });
      // Roof plant, so a block of buildings does not read as one slab.
      const rx = x + inset + size * 0.14;
      const ry = y + inset + size * 0.14;
      features
        .rect(rx, ry, size * (0.2 + hash(column, row, 121) * 0.24), size * 0.16)
        .fill({ color: 0x504b46 });
      return;
    }

    case 'impassable': {
      features
        .rect(x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8)
        .fill({ color: 0x1b1d21 })
        .stroke({ width: 1, color: 0x33363c, alpha: 0.8 });
      return;
    }

    default:
      // Open ground: an occasional tuft, nothing more.
      if (hash(column, row, 131) > 0.72) {
        const cx = x + size * (0.25 + hash(column, row, 141) * 0.5);
        const cy = y + size * (0.25 + hash(column, row, 151) * 0.5);
        features
          .circle(cx, cy, size * 0.05)
          .fill({ color: 0x3f4c35, alpha: 0.6 });
      }
  }
}

/** Roads are drawn as a continuous band toward each road neighbour, not as squares. */
function paintRoad(
  roads: Graphics,
  tiles: Tile[][],
  grid: TerrainGrid,
  column: number,
  row: number,
): void {
  if (terrainAt(tiles, column, row) !== 'road') return;

  const size = grid.tileSize;
  const cx = column * size + size / 2;
  const cy = row * size + size / 2;
  const width = size * 0.52;
  const surface = 0x59513f;

  roads.circle(cx, cy, width / 2).fill({ color: surface });

  const arms: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let connections = 0;

  for (const [dx, dy] of arms) {
    if (terrainAt(tiles, column + dx, row + dy) !== 'road') continue;
    connections += 1;
    const length = size / 2;
    roads
      .rect(
        cx + (dx === 0 ? -width / 2 : dx > 0 ? 0 : -length),
        cy + (dy === 0 ? -width / 2 : dy > 0 ? 0 : -length),
        dx === 0 ? width : length,
        dy === 0 ? width : length,
      )
      .fill({ color: surface });
  }

  // Centre dashes only where the road actually runs through.
  if (connections >= 2) {
    roads
      .circle(cx, cy, size * 0.045)
      .fill({ color: 0xb6a878, alpha: 0.35 });
  }
}

export function buildTilemap(grid: TerrainGrid, data: TerrainMapData): Container {
  const layer = new Container();
  const ground = new Graphics();
  const roads = new Graphics();
  const features = new Graphics();
  const relief = new Graphics();

  const tiles = readTiles(grid, data);

  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      paintGround(ground, tiles, grid, column, row);
    }
  }
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      blendEdges(ground, tiles, grid, column, row);
      paintRoad(roads, tiles, grid, column, row);
      paintFeatures(features, tiles, grid, column, row);
    }
  }

  // Relief last, over everything, so a ridge reads through the trees on it.
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const here = grid.elevationAt(column, row);
      const size = grid.tileSize;
      if (here > grid.elevationAt(column, row - 1)) {
        relief
          .moveTo(column * size, row * size)
          .lineTo((column + 1) * size, row * size)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.14 });
      }
      if (here > grid.elevationAt(column, row + 1)) {
        relief
          .moveTo(column * size, (row + 1) * size)
          .lineTo((column + 1) * size, (row + 1) * size)
          .stroke({ width: 2.5, color: 0x000000, alpha: 0.34 });
      }
      if (here > grid.elevationAt(column - 1, row)) {
        relief
          .moveTo(column * size, row * size)
          .lineTo(column * size, (row + 1) * size)
          .stroke({ width: 1.5, color: 0xffffff, alpha: 0.08 });
      }
      if (here > grid.elevationAt(column + 1, row)) {
        relief
          .moveTo((column + 1) * size, row * size)
          .lineTo((column + 1) * size, (row + 1) * size)
          .stroke({ width: 2, color: 0x000000, alpha: 0.26 });
      }
    }
  }

  layer.addChild(ground, roads, features, relief);
  return layer;
}
