import { Container, Graphics } from 'pixi.js';
import type { TerrainMapData } from '../schema/map';
import type { TerrainGrid } from '../sim/terrain';
import { shade, TERRAIN_COLOURS, UI } from './palette';

const ELEVATION_LIFT = 0.13;

export function buildTilemap(grid: TerrainGrid, data: TerrainMapData): Container {
  const layer = new Container();
  const ground = new Graphics();
  const edges = new Graphics();

  for (let row = 0; row < grid.height; row += 1) {
    const symbols = data.tiles[row] ?? '';
    for (let column = 0; column < grid.width; column += 1) {
      const terrainId = data.legend[symbols[column] ?? ''] ?? 'open';
      const elevation = grid.elevationAt(column, row);
      const base = TERRAIN_COLOURS[terrainId] ?? TERRAIN_COLOURS.open ?? 0x2f3a2c;

      ground
        .rect(column * grid.tileSize, row * grid.tileSize, grid.tileSize, grid.tileSize)
        .fill({ color: shade(base, 1 + elevation * ELEVATION_LIFT) });

      // A lit north edge wherever the ground steps up: cheap 2.5D relief.
      if (elevation > grid.elevationAt(column, row - 1)) {
        edges
          .moveTo(column * grid.tileSize, row * grid.tileSize)
          .lineTo((column + 1) * grid.tileSize, row * grid.tileSize)
          .stroke({ width: 1.5, color: 0xffffff, alpha: 0.16 });
      }
      if (elevation < grid.elevationAt(column, row + 1)) {
        edges
          .moveTo(column * grid.tileSize, (row + 1) * grid.tileSize)
          .lineTo((column + 1) * grid.tileSize, (row + 1) * grid.tileSize)
          .stroke({ width: 1.5, color: 0x000000, alpha: 0.28 });
      }
    }
  }

  const gridLines = new Graphics();
  for (let column = 0; column <= grid.width; column += 1) {
    gridLines
      .moveTo(column * grid.tileSize, 0)
      .lineTo(column * grid.tileSize, grid.height * grid.tileSize);
  }
  for (let row = 0; row <= grid.height; row += 1) {
    gridLines
      .moveTo(0, row * grid.tileSize)
      .lineTo(grid.width * grid.tileSize, row * grid.tileSize);
  }
  gridLines.stroke({ width: 1, color: UI.grid, alpha: 0.12 });

  layer.addChild(ground, edges, gridLines);
  return layer;
}
