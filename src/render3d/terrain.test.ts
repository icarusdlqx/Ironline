import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { createTerrainGrid } from '../sim/terrain';
import { buildTerrain } from './terrain';

describe('render terrain height', () => {
  it('samples the same diagonal facets that the indexed mesh draws', () => {
    const data = catalog.maps.get('ridge_pass');
    expect(data).toBeDefined();
    if (data === undefined) return;
    const grid = createTerrainGrid(data, catalog.rules.terrain);
    const terrain = buildTerrain(grid, data);
    const positions = terrain.mesh.geometry.getAttribute('position');
    const across = grid.width + 1;
    const height = (column: number, row: number): number => positions.getY(row * across + column);
    let column = 0;
    let row = 0;
    let nonCoplanar = false;
    for (let candidateRow = 0; candidateRow < grid.height; candidateRow += 1) {
      for (let candidateColumn = 0; candidateColumn < grid.width; candidateColumn += 1) {
        const diagonal = Math.abs(
          height(candidateColumn, candidateRow)
          + height(candidateColumn + 1, candidateRow + 1)
          - height(candidateColumn + 1, candidateRow)
          - height(candidateColumn, candidateRow + 1),
        );
        if (diagonal > 0.2) {
          column = candidateColumn;
          row = candidateRow;
          nonCoplanar = true;
        }
      }
    }
    expect(nonCoplanar).toBe(true);

    const a = height(column, row);
    const b = height(column + 1, row);
    const c = height(column, row + 1);
    const d = height(column + 1, row + 1);
    const size = grid.tileSize;
    const sample = (fx: number, fy: number): number =>
      terrain.heightAt((column + fx) * size, (row + fy) * size);
    expect(sample(0.2, 0.3)).toBeCloseTo(a + (b - a) * 0.2 + (c - a) * 0.3, 6);
    expect(sample(0.7, 0.6)).toBeCloseTo(d + (c - d) * 0.3 + (b - d) * 0.4, 6);

    terrain.mesh.geometry.dispose();
    if (Array.isArray(terrain.mesh.material)) {
      terrain.mesh.material.forEach((material) => material.dispose());
    } else {
      terrain.mesh.material.dispose();
    }
  });
});
