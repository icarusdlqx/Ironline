import { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { TerrainMapData } from '../schema/map';
import type { TeamVision } from '../sim/sensors';
import { createTerrainGrid } from '../sim/terrain';
import { PropLayer } from './props';

const EXPECTED_BATCHES: Record<string, readonly string[]> = {
  ridge_pass: ['props-tree', 'props-snag', 'props-boulder', 'props-block'],
  causeway: ['props-tree', 'props-boulder', 'props-causeway'],
  foundry_district: ['props-block', 'props-wreckage'],
  shale_steps: ['props-tree', 'props-snag', 'props-shale', 'props-crag'],
};

const EXPECTED_SHADOW_BATCHES: Record<string, number> = {
  ridge_pass: 3,
  causeway: 2,
  foundry_district: 2,
  shale_steps: 3,
};

function mapData(id: string): TerrainMapData {
  const data = catalog.maps.get(id);
  if (data === undefined) throw new Error(`missing test map ${id}`);
  return data;
}

function build(id: string): PropLayer {
  const data = mapData(id);
  const grid = createTerrainGrid(data, catalog.rules.terrain);
  return new PropLayer(grid, data, () => 0);
}

function meshes(layer: PropLayer): InstancedMesh[] {
  return layer.group.children.map((child) => child as InstancedMesh);
}

function signature(layer: PropLayer): unknown {
  return meshes(layer).map((mesh) => ({
    name: mesh.name,
    count: mesh.count,
    matrices: Array.from(mesh.instanceMatrix.array),
    colours: Array.from(mesh.instanceColor?.array ?? []),
  }));
}

function firstTile(data: TerrainMapData, terrainId: string): number {
  for (let row = 0; row < data.height; row += 1) {
    for (let column = 0; column < data.width; column += 1) {
      const symbol = data.tiles[row]?.[column] ?? '';
      if (data.legend[symbol] === terrainId) return row * data.width + column;
    }
  }
  throw new Error(`map ${data.id} has no ${terrainId} tile`);
}

describe('PropLayer', () => {
  it.each(Object.entries(EXPECTED_BATCHES))(
    'keeps %s within its old prop draw budget',
    (mapId, expected) => {
      const batches = meshes(build(mapId));
      const shadowBatches = EXPECTED_SHADOW_BATCHES[mapId];
      if (shadowBatches === undefined) throw new Error(`missing shadow budget for ${mapId}`);
      expect(batches.map((mesh) => mesh.name)).toEqual(expected);
      expect(batches.filter((mesh) => mesh.castShadow)).toHaveLength(shadowBatches);
    },
  );

  it.each(Object.keys(EXPECTED_BATCHES))('places %s props deterministically', (mapId) => {
    expect(signature(build(mapId))).toEqual(signature(build(mapId)));
  });

  it('uploads only newly revealed forest instances after the first sweep', () => {
    const data = mapData('ridge_pass');
    const layer = build(data.id);
    const cells = data.width * data.height;
    const vision: TeamVision = {
      team: 0,
      visible: new Set(),
      identified: new Set(),
      ghosts: new Map(),
      tiles: new Uint8Array(cells),
      explored: new Uint8Array(cells),
    };

    layer.update(vision);
    for (const mesh of meshes(layer)) mesh.instanceMatrix.clearUpdateRanges();

    vision.explored[firstTile(data, 'forest')] = 1;
    layer.update(vision);

    const ranges = meshes(layer).flatMap((mesh) => mesh.instanceMatrix.updateRanges);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((range) => range.count === 16)).toBe(true);
  });
});
