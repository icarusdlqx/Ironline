import { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { PropLayer } from '../render3d/props';
import { createTerrainGrid } from '../sim/terrain';
import type { TerrainMapData } from './map';

const EXPECTED = {
  cutbank_exchange: {
    name: 'Cutbank Exchange',
    atmosphereId: 'industrial_smog',
    propTheme: 'industrial',
    tiles: { '.': 1749, '=': 623, r: 203, b: 361, w: 200 },
    elevation: { 0: 2921, 1: 215 },
    props: { 'props-block': 361, 'props-wreckage': 36 },
  },
  blackglass_quarry: {
    name: 'Blackglass Quarry',
    atmosphereId: 'dust_storm',
    propTheme: 'shale',
    tiles: { '.': 2081, f: 73, r: 557, '=': 262, x: 65, b: 80, w: 18 },
    elevation: { 0: 4, 1: 140, 2: 432, 3: 720, 4: 820, 5: 1020 },
    props: {
      'props-tree': 125,
      'props-snag': 55,
      'props-shale': 240,
      'props-crag': 130,
      'props-block': 80,
    },
  },
} as const;

function mapData(id: string): TerrainMapData {
  const map = catalog.maps.get(id);
  if (map === undefined) throw new Error(`missing large map ${id}`);
  return map;
}

function countSymbols(rows: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const symbol of rows.join('')) counts[symbol] = (counts[symbol] ?? 0) + 1;
  return counts;
}

function reachablePassableTiles(map: TerrainMapData): { reachable: number; passable: number } {
  const grid = createTerrainGrid(map, catalog.rules.terrain);
  const visited = new Uint8Array(map.width * map.height);
  const pending: number[] = [];
  let passable = 0;

  for (let row = 0; row < map.height; row += 1) {
    for (let column = 0; column < map.width; column += 1) {
      if (!grid.passable(column, row)) continue;
      passable += 1;
      if (pending.length === 0) pending.push(row * map.width + column);
    }
  }

  let reachable = 0;
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === undefined || visited[index] === 1) continue;
    const column = index % map.width;
    const row = Math.floor(index / map.width);
    if (!grid.passable(column, row)) continue;
    visited[index] = 1;
    reachable += 1;
    for (const [offsetX, offsetY] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nextX = column + offsetX;
      const nextY = row + offsetY;
      if (!grid.inBounds(nextX, nextY)) continue;
      const next = nextY * map.width + nextX;
      if (visited[next] === 0) pending.push(next);
    }
  }

  return { reachable, passable };
}

describe('large battlefields', () => {
  it.each(Object.entries(EXPECTED))('loads the exact %s authored grid', (id, expected) => {
    const map = mapData(id);

    expect(map).toMatchObject({
      id,
      name: expected.name,
      tileSize: 24,
      width: 56,
      height: 56,
      atmosphereId: expected.atmosphereId,
      propTheme: expected.propTheme,
    });
    expect(map.tiles).toHaveLength(56);
    expect(map.tiles.every((row) => row.length === 56)).toBe(true);
    expect(map.elevation).toHaveLength(56);
    expect(map.elevation?.every((row) => row.length === 56)).toBe(true);
    expect(countSymbols(map.tiles)).toEqual(expected.tiles);
    expect(countSymbols(map.elevation ?? [])).toEqual(expected.elevation);
  });

  it.each(Object.keys(EXPECTED))('keeps every passable %s tile in one component', (id) => {
    const connectivity = reachablePassableTiles(mapData(id));
    expect(connectivity.reachable).toBe(connectivity.passable);
    expect(connectivity.passable).toBeGreaterThan(0);
  });

  it.each(Object.entries(EXPECTED))('keeps %s scenery inside its fixed prop batches', (id, expected) => {
    const map = mapData(id);
    const grid = createTerrainGrid(map, catalog.rules.terrain);
    const layer = new PropLayer(grid, map, () => 0);

    try {
      const counts = Object.fromEntries(
        layer.group.children.map((child) => [
          child.name,
          child instanceof InstancedMesh ? child.count : 0,
        ]),
      );
      expect(counts).toEqual(expected.props);
    } finally {
      layer.dispose();
    }
  });
});
