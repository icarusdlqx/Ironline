import type { TerrainGrid } from './terrain';
import type { Vec2 } from './types';

export interface LineOfSight {
  clear: boolean;
  obstruction: number;
  blockedByElevation: boolean;
}

const BLOCKING_OBSTRUCTION = 1;

// Amanatides-Woo voxel traversal: every tile the segment passes through is visited exactly once.
export function traceTiles(
  grid: TerrainGrid,
  from: Vec2,
  to: Vec2,
  visit: (column: number, row: number) => boolean,
): void {
  const start = grid.toTile(from);
  const end = grid.toTile(to);

  let column = start.column;
  let row = start.row;

  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const stepColumn = Math.sign(deltaX);
  const stepRow = Math.sign(deltaY);

  const nextBoundaryX =
    stepColumn > 0 ? (column + 1) * grid.tileSize : column * grid.tileSize;
  const nextBoundaryY = stepRow > 0 ? (row + 1) * grid.tileSize : row * grid.tileSize;

  let maxX = deltaX === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryX - from.x) / deltaX;
  let maxY = deltaY === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryY - from.y) / deltaY;

  const deltaTX = deltaX === 0 ? Number.POSITIVE_INFINITY : Math.abs(grid.tileSize / deltaX);
  const deltaTY = deltaY === 0 ? Number.POSITIVE_INFINITY : Math.abs(grid.tileSize / deltaY);

  let guard = grid.width + grid.height + 4;

  while (guard > 0) {
    if (column === end.column && row === end.row) return;
    if (maxX < maxY) {
      maxX += deltaTX;
      column += stepColumn;
    } else {
      maxY += deltaTY;
      row += stepRow;
    }
    if (column === end.column && row === end.row) return;
    if (!visit(column, row)) return;
    guard -= 1;
  }
}

export function lineOfSight(grid: TerrainGrid, from: Vec2, to: Vec2): LineOfSight {
  const start = grid.toTile(from);
  const end = grid.toTile(to);
  const maxElevation = Math.max(
    grid.elevationAt(start.column, start.row),
    grid.elevationAt(end.column, end.row),
  );

  let obstruction = 0;
  let blockedByElevation = false;

  traceTiles(grid, from, to, (column, row) => {
    if (grid.elevationAt(column, row) > maxElevation) {
      blockedByElevation = true;
      return false;
    }
    obstruction += grid.typeAt(column, row).losObstruction;
    return obstruction < BLOCKING_OBSTRUCTION;
  });

  return {
    clear: !blockedByElevation && obstruction < BLOCKING_OBSTRUCTION,
    obstruction,
    blockedByElevation,
  };
}

export function coverFactorAt(grid: TerrainGrid, point: Vec2): number {
  return grid.typeAtPoint(point).coverFactor;
}
