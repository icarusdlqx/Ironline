import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import type { TerrainMapData } from '../schema/map';
import type { TerrainGrid } from '../sim/terrain';
import { mix, shade, TERRAIN_COLOURS } from '../render/palette';

/** Bare rock, for ground too steep to hold anything else. */
const ROCK = 0x6d675d;
/** What deep water grades toward away from its own shore. */
const DEEP_WATER = 0x102636;

/**
 * Metres of height per elevation step in the map data. Purely a matter of how
 * the ground reads: the simulation gets its cover and line of sight from the
 * elevation numbers themselves, not from this. Maps use a handful of steps
 * across a kilometre, so the scale has to be generous or every ridge in the
 * game looks like a painted line.
 */
export const HEIGHT_PER_STEP = 26;

/** Deterministic per-corner jitter, so the same map builds the same hills. */
function hash(column: number, row: number, salt: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function colourFor(terrainId: string): number {
  return TERRAIN_COLOURS[terrainId] ?? TERRAIN_COLOURS.open ?? 0x2f3a2c;
}

/**
 * Smooth value noise a few tiles wide, so open ground mottles into dry and
 * lush patches instead of reading as one continuous billiard table. Smooth
 * because a per-tile change of this size would draw a visible grid.
 */
function patchNoise(column: number, row: number): number {
  const cx = column / 6;
  const cy = row / 6;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const blend = (a: number, b: number, t: number): number =>
    a + (b - a) * t * t * (3 - 2 * t);
  const fx = cx - x0;
  const top = blend(hash(x0, y0, 21), hash(x0 + 1, y0, 21), fx);
  const bottom = blend(hash(x0, y0 + 1, 21), hash(x0 + 1, y0 + 1, 21), fx);
  return blend(top, bottom, cy - y0) - 0.5;
}

/** How strongly a terrain type mottles: paving stays paved, meadows vary. */
const MOTTLE: Record<string, number> = {
  open: 0.22,
  forest: 0.16,
  rough: 0.16,
  water: 0.1,
  road: 0.05,
  building: 0.05,
  impassable: 0.08,
};

function terrainIdAt(data: TerrainMapData, column: number, row: number): string {
  return data.legend[data.tiles[row]?.[column] ?? ''] ?? 'open';
}

/**
 * Ground height at a tile corner, averaged from the tiles that meet there so
 * neighbouring elevations join into a slope instead of a step. Cliffs come out
 * of the elevation data being far apart, not out of special-casing them.
 */
function cornerHeight(grid: TerrainGrid, column: number, row: number): number {
  let total = 0;
  let count = 0;
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const c = column + dx;
    const r = row + dy;
    if (!grid.inBounds(c, r)) continue;
    total += grid.elevationAt(c, r);
    count += 1;
  }
  if (count === 0) return 0;
  // A little jitter breaks the flatness of open ground without moving anything
  // far enough to disagree with the tile the simulation thinks you are on.
  return (total / count) * HEIGHT_PER_STEP + (hash(column, row, 3) - 0.5) * 1.4;
}

export interface TerrainMesh {
  mesh: Mesh;
  /** Ground height under a battlefield point, for standing mechs on the hills. */
  heightAt(x: number, y: number): number;
}

/**
 * One mesh for the whole battlefield: a grid of quads lifted by the map's own
 * elevation data and tinted per corner by the terrain under it. Vertex colours
 * rather than a texture — the palette is the same one the 2D map used, so the
 * ground still reads as the same place.
 */
export function buildTerrain(grid: TerrainGrid, data: TerrainMapData): TerrainMesh {
  const size = grid.tileSize;
  const across = grid.width + 1;
  const down = grid.height + 1;

  const positions = new Float32Array(across * down * 3);
  const colours = new Float32Array(across * down * 3);
  const heights = new Float32Array(across * down);
  const scratch = new Color();

  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const index = row * across + column;
      const height = cornerHeight(grid, column, row);
      heights[index] = height;

      positions[index * 3] = column * size;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = row * size;
    }
  }

  /** Corner height with the edges clamped, for reading slope off neighbours. */
  const heightAtCorner = (column: number, row: number): number => {
    const c = Math.max(0, Math.min(across - 1, column));
    const r = Math.max(0, Math.min(down - 1, row));
    return heights[r * across + c] ?? 0;
  };

  /** How much of a tile's neighbourhood is also water, 0 at a shore to 1 mid-channel. */
  const wetness = (column: number, row: number): number => {
    let wet = 0;
    let counted = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = column + dc;
        const r = row + dr;
        if (!grid.inBounds(c, r)) continue;
        counted += 1;
        if (terrainIdAt(data, c, r) === 'water') wet += 1;
      }
    }
    return counted === 0 ? 0 : wet / counted;
  };

  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const index = row * across + column;
      // Corners take the colour of the tile up and left of them, which is the
      // one whose quad this corner opens.
      const tileColumn = Math.min(column, grid.width - 1);
      const tileRow = Math.min(row, grid.height - 1);
      const tile = terrainIdAt(data, tileColumn, tileRow);

      const lift =
        1 +
        (heights[index] ?? 0) / HEIGHT_PER_STEP * 0.05 +
        (hash(column, row, 9) - 0.5) * 0.12 +
        patchNoise(column, row) * (MOTTLE[tile] ?? 0.1);

      let colour = shade(colourFor(tile), lift);

      // Ground too steep to hold soil shows the rock underneath. Terraces and
      // scarps are elevation data, not a terrain type, so without this a cliff
      // face is grass standing on its end.
      const rise = Math.hypot(
        (heightAtCorner(column + 1, row) - heightAtCorner(column - 1, row)) / (2 * size),
        (heightAtCorner(column, row + 1) - heightAtCorner(column, row - 1)) / (2 * size),
      );
      if (tile !== 'water') {
        const bare = Math.max(0, Math.min(1, (rise - 0.35) / 0.55));
        if (bare > 0) colour = mix(colour, shade(ROCK, lift), bare * 0.85);
      } else {
        // Water reads as depth: pale over the shallows it is fordable at,
        // grading to something you would not walk a mech into.
        colour = mix(colour, DEEP_WATER, wetness(tileColumn, tileRow) * 0.85);
      }

      scratch.setHex(colour);
      colours[index * 3] = scratch.r;
      colours[index * 3 + 1] = scratch.g;
      colours[index * 3 + 2] = scratch.b;
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const a = row * across + column;
      const b = a + 1;
      const c = a + across;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new Mesh(
    geometry,
    new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  return {
    mesh,
    heightAt: (x, y) => sampleHeight(heights, across, grid, x, y),
  };
}

/** Bilinear sample of the corner heights, so a mech walks up a slope smoothly. */
function sampleHeight(
  heights: Float32Array,
  across: number,
  grid: TerrainGrid,
  x: number,
  y: number,
): number {
  const size = grid.tileSize;
  const gx = Math.min(grid.width, Math.max(0, x / size));
  const gy = Math.min(grid.height, Math.max(0, y / size));

  const column = Math.min(grid.width - 1, Math.floor(gx));
  const row = Math.min(grid.height - 1, Math.floor(gy));
  const fx = gx - column;
  const fy = gy - row;

  const at = (c: number, r: number): number => heights[r * across + c] ?? 0;
  const top = at(column, row) * (1 - fx) + at(column + 1, row) * fx;
  const bottom = at(column, row + 1) * (1 - fx) + at(column + 1, row + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
