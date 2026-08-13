import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { TerrainMapData } from '../schema/map';
import type { TeamVision } from '../sim/sensors';
import type { TerrainGrid } from '../sim/terrain';
import { shade } from '../render/palette';

/**
 * Ceilings per prop kind, so a map that is wall-to-wall forest cannot ask a
 * phone for ten thousand trees. When a map wants more than the ceiling the
 * placements are thinned evenly rather than truncated, so the far corner of
 * the map does not go mysteriously bald.
 */
const CAPS = { canopy: 2_200, trunk: 2_200, boulder: 800, crag: 600, block: 900 } as const;

type Kind = keyof typeof CAPS;

/** Deterministic per-tile jitter; the same map always grows the same woods. */
function hash(column: number, row: number, salt: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function terrainIdAt(data: TerrainMapData, column: number, row: number): string {
  return data.legend[data.tiles[row]?.[column] ?? ''] ?? 'open';
}

interface Placement {
  /** Tile index in the vision grid, for hiding props on unexplored ground. */
  tile: number;
  matrix: Matrix4;
  colour: Color;
}

interface Batch {
  mesh: InstancedMesh;
  placements: Placement[];
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/**
 * Set dressing grown from the same tile data the simulation fights over:
 * conifers on forest, boulders on rough going, crags where nothing walks, and
 * blocks where the map says building. One instanced draw per prop kind, so the
 * whole layer costs five draw calls however dense the map is. Props on ground
 * the lance has never seen are scaled away — the shroud skin hugs the terrain,
 * and a lit smokestack poking out of black fog would hand out intel for free.
 */
export class PropLayer {
  readonly group = new Group();

  private readonly batches: Batch[] = [];
  private exploredCount = -1;

  constructor(
    grid: TerrainGrid,
    data: TerrainMapData,
    heightAt: (x: number, y: number) => number,
  ) {
    this.group.name = 'props';
    const size = grid.tileSize;
    const pending: Record<Kind, Placement[]> = {
      canopy: [],
      trunk: [],
      boulder: [],
      crag: [],
      block: [],
    };

    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const lean = new Vector3(1, 0, 0);

    const place = (
      kind: Kind,
      tile: number,
      x: number,
      y: number,
      sx: number,
      sy: number,
      sz: number,
      colour: number,
      spin: number,
      tilt = 0,
    ): void => {
      position.set(x, heightAt(x, y) - 0.4, y);
      rotation.setFromAxisAngle(up, spin * Math.PI * 2);
      if (tilt !== 0) rotation.multiply(new Quaternion().setFromAxisAngle(lean, tilt));
      scale.set(sx, sy, sz);
      pending[kind].push({
        tile,
        matrix: new Matrix4().compose(position, rotation, scale),
        colour: new Color(colour),
      });
    };

    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const id = terrainIdAt(data, column, row);
        const tile = row * grid.width + column;
        const h = (salt: number): number => hash(column, row, salt);

        if (id === 'forest') {
          const trees = 2 + (h(11) < 0.45 ? 1 : 0);
          for (let i = 0; i < trees; i += 1) {
            const x = (column + 0.15 + 0.7 * h(13 + i * 7)) * size;
            const y = (row + 0.15 + 0.7 * h(17 + i * 7)) * size;
            const height = 8 + h(19 + i * 7) * 6;
            const radius = height * 0.32;
            const green = shade(0x2a4a30, 0.8 + h(23 + i * 7) * 0.4);
            place('canopy', tile, x, y, radius, height * 0.82, radius, green, h(29 + i));
            place('trunk', tile, x, y, 1, height * 0.3, 1, 0x4a3a28, h(29 + i));
          }
        } else if (id === 'rough' && h(5) < 0.3) {
          const girth = 1.3 + h(31) * 2.1;
          place(
            'boulder', tile,
            (column + 0.2 + 0.6 * h(37)) * size,
            (row + 0.2 + 0.6 * h(41)) * size,
            girth, 0.9 + h(43) * 1.4, girth * (0.8 + h(47) * 0.4),
            shade(0x6a6154, 0.8 + h(53) * 0.4), h(59),
          );
        } else if (id === 'impassable') {
          for (let i = 0; i < 2; i += 1) {
            const girth = 2.2 + h(61 + i * 5) * 2.4;
            place(
              'crag', tile,
              (column + 0.2 + 0.6 * h(67 + i * 5)) * size,
              (row + 0.2 + 0.6 * h(71 + i * 5)) * size,
              girth, 7 + h(73 + i * 5) * 9, girth,
              shade(0x363a42, 0.8 + h(79 + i * 5) * 0.4),
              h(83 + i), (h(89 + i) - 0.5) * 0.24,
            );
          }
        } else if (id === 'building') {
          place(
            'block', tile,
            (column + 0.5) * size,
            (row + 0.5) * size,
            size * (0.62 + h(91) * 0.24), 9 + h(97) * 20, size * (0.62 + h(101) * 0.24),
            shade(0x6e6960, 0.78 + h(103) * 0.44), 0,
          );
        }
      }
    }

    const geometries: Record<Kind, BufferGeometry> = {
      canopy: new ConeGeometry(1, 1, 6).translate(0, 0.5, 0),
      trunk: new CylinderGeometry(0.16, 0.24, 1, 5).translate(0, 0.5, 0),
      boulder: new IcosahedronGeometry(1, 0),
      crag: new ConeGeometry(1, 1, 5).translate(0, 0.5, 0),
      block: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    };

    for (const kind of Object.keys(pending) as Kind[]) {
      let placements = pending[kind];
      if (placements.length === 0) continue;
      if (placements.length > CAPS[kind]) {
        const stride = placements.length / CAPS[kind];
        placements = Array.from(
          { length: CAPS[kind] },
          (_, i) => placements[Math.floor(i * stride)],
        ).filter((entry): entry is Placement => entry !== undefined);
      }

      const mesh = new InstancedMesh(
        geometries[kind],
        new MeshLambertMaterial({ flatShading: true }),
        placements.length,
      );
      for (let i = 0; i < placements.length; i += 1) {
        const entry = placements[i];
        if (entry === undefined) continue;
        mesh.setMatrixAt(i, entry.matrix);
        mesh.setColorAt(i, entry.colour);
      }
      mesh.castShadow = kind !== 'trunk';
      mesh.receiveShadow = kind === 'block';
      // The base geometry's bounding sphere says nothing about where the
      // instances are, so culling by it blanks the layer at some camera angles.
      mesh.frustumCulled = false;
      mesh.name = `props-${kind}`;
      this.batches.push({ mesh, placements });
      this.group.add(mesh);
    }
  }

  /** Hides props on unexplored tiles; exploration only ever grows, so this is
   *  a cheap count-compare almost every frame and a sweep when it changes. */
  update(vision: TeamVision | null): void {
    let count = Number.MAX_SAFE_INTEGER;
    if (vision !== null) {
      count = 0;
      for (let i = 0; i < vision.explored.length; i += 1) count += vision.explored[i] ?? 0;
    }
    if (count === this.exploredCount) return;
    this.exploredCount = count;

    for (const batch of this.batches) {
      for (let i = 0; i < batch.placements.length; i += 1) {
        const entry = batch.placements[i];
        if (entry === undefined) continue;
        const shown = vision === null || vision.explored[entry.tile] === 1;
        batch.mesh.setMatrixAt(i, shown ? entry.matrix : HIDDEN);
      }
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
