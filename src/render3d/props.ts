import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { TerrainMapData } from '../schema/map';
import type { TeamVision } from '../sim/sensors';
import type { TerrainGrid } from '../sim/terrain';
import { shade } from '../render/palette';
import { createPropGeometry, type PropKind } from './propGeometry';

/**
 * Ceilings per prop kind, so a map that is wall-to-wall forest cannot ask a
 * phone for ten thousand trees. When a map wants more than the ceiling the
 * placements are thinned evenly rather than truncated, so the far corner of
 * the map does not go mysteriously bald.
 */
const CAPS = {
  tree: 2_200,
  snag: 800,
  boulder: 800,
  shale: 800,
  crag: 600,
  block: 900,
  causeway: 180,
  wreckage: 300,
} as const satisfies Record<PropKind, number>;

/** Deterministic per-tile jitter; the same map always grows the same woods. */
function hash(column: number, row: number, salt: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function terrainIdAt(data: TerrainMapData, column: number, row: number): string {
  return data.legend[data.tiles[row]?.[column] ?? ''] ?? 'open';
}

function waterEdge(
  data: TerrainMapData,
  column: number,
  row: number,
): readonly [number, number] | null {
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    if (terrainIdAt(data, column + dc, row + dr) === 'water') return [dc, dr];
  }
  return null;
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
 * Set dressing grown from the same tile data the simulation fights over. Each
 * map spends no more prop batches than the old trees, rocks and blocks did;
 * detail sits inside merged geometry rather than buying another draw. Props on
 * ground the lance has never seen are scaled away — the shroud skin hugs the
 * terrain, and a lit smokestack poking out of black fog would hand out intel.
 */
export class PropLayer {
  readonly group = new Group();

  private readonly batches: Batch[] = [];
  private exploredCount = -1;
  /**
   * The explored map as of the last reveal, so a change only touches the
   * tiles that actually flipped. Exploration in forest arrives one tile per
   * sim tick — the trees block the sightlines — and rewriting and re-uploading
   * every instance on the map twenty times a second for that is exactly the
   * kind of buffer churn that reads as "it stutters in the woods".
   */
  private revealed: Uint8Array | null = null;
  /** Instances on each tile, as [batch index, instance index] pairs. */
  private readonly tileInstances = new Map<number, [number, number][]>();

  constructor(
    grid: TerrainGrid,
    data: TerrainMapData,
    heightAt: (x: number, y: number) => number,
    /** The same tint the ground took, so the scenery matches the ground it is on. */
    tint: { colour: Color; strength: number } | null = null,
  ) {
    this.group.name = 'props';
    const size = grid.tileSize;
    const theme = data.propTheme ?? 'alpine';
    const pending: Record<PropKind, Placement[]> = {
      tree: [],
      snag: [],
      boulder: [],
      shale: [],
      crag: [],
      block: [],
      causeway: [],
      wreckage: [],
    };

    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const lean = new Vector3(1, 0, 0);

    const place = (
      kind: PropKind,
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
        colour:
          tint === null
            ? new Color(colour)
            : new Color(colour).lerp(tint.colour, tint.strength),
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
            const snagChance = theme === 'shale' ? 0.32 : theme === 'alpine' ? 0.16 : 0;
            const dead = h(107 + i * 7) < snagChance;
            const tone = shade(0xffffff, 0.82 + h(23 + i * 7) * 0.18);
            place(
              dead ? 'snag' : 'tree', tile, x, y,
              dead ? radius * 0.46 : radius,
              dead ? height * 0.78 : height,
              dead ? radius * 0.46 : radius,
              tone, h(29 + i),
              theme === 'causeway' ? (h(109 + i * 7) - 0.5) * 0.12 : 0,
            );
          }
        } else if (id === 'rough') {
          if (theme === 'industrial' && h(5) < 0.2) {
            const width = 5 + h(31) * 3.5;
            place(
              'wreckage', tile,
              (column + 0.18 + 0.64 * h(37)) * size,
              (row + 0.18 + 0.64 * h(41)) * size,
              width, 4 + h(43) * 3, width * (0.75 + h(47) * 0.3),
              shade(0xffffff, 0.78 + h(53) * 0.2), h(59),
            );
          } else if (theme === 'shale' && h(5) < 0.42) {
            const girth = 2.2 + h(31) * 2.5;
            place(
              'shale', tile,
              (column + 0.18 + 0.64 * h(37)) * size,
              (row + 0.18 + 0.64 * h(41)) * size,
              girth, 4.5 + h(43) * 5.5, girth * (0.7 + h(47) * 0.35),
              shade(0xffffff, 0.8 + h(53) * 0.18), h(59),
              (h(61) - 0.5) * 0.18,
            );
          } else if (theme !== 'industrial' && theme !== 'shale' && h(5) < 0.3) {
            const girth = 1.8 + h(31) * 2.3;
            place(
              'boulder', tile,
              (column + 0.2 + 0.6 * h(37)) * size,
              (row + 0.2 + 0.6 * h(41)) * size,
              girth, 1.5 + h(43) * 2, girth * (0.8 + h(47) * 0.4),
              shade(0xffffff, 0.8 + h(53) * 0.18), h(59),
            );
          }
        } else if (id === 'impassable') {
          for (let i = 0; i < 2; i += 1) {
            const girth = 2.2 + h(61 + i * 5) * 2.4;
            place(
              'crag', tile,
              (column + 0.2 + 0.6 * h(67 + i * 5)) * size,
              (row + 0.2 + 0.6 * h(71 + i * 5)) * size,
              girth, 7 + h(73 + i * 5) * 9, girth,
              shade(0xffffff, 0.8 + h(79 + i * 5) * 0.18),
              h(83 + i), (h(89 + i) - 0.5) * 0.24,
            );
          }
        } else if (id === 'building') {
          place(
            'block', tile,
            (column + 0.5) * size,
            (row + 0.5) * size,
            size * (0.62 + h(91) * 0.24), 9 + h(97) * 20, size * (0.62 + h(101) * 0.24),
            shade(0xffffff, 0.8 + h(103) * 0.18),
            theme === 'industrial' && h(107) < 0.5 ? 0.25 : 0,
          );
        } else if (id === 'road' && theme === 'causeway') {
          const edge = waterEdge(data, column, row);
          if (edge === null) continue;
          const [dc, dr] = edge;
          const tangentJitter = (h(113) - 0.5) * 0.08;
          place(
            'causeway', tile,
            (column + 0.5 + dc * 0.42 - dr * tangentJitter) * size,
            (row + 0.5 + dr * 0.42 + dc * tangentJitter) * size,
            size * 0.88, 8 + h(127) * 2.5, size * 0.34,
            shade(0xffffff, 0.84 + h(131) * 0.14), dc === 0 ? 0 : 0.25,
          );
        }
      }
    }

    for (const kind of Object.keys(pending) as PropKind[]) {
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
        createPropGeometry(kind, theme),
        new MeshLambertMaterial({ flatShading: true, vertexColors: true }),
        placements.length,
      );
      for (let i = 0; i < placements.length; i += 1) {
        const entry = placements[i];
        if (entry === undefined) continue;
        mesh.setMatrixAt(i, entry.matrix);
        mesh.setColorAt(i, entry.colour);
      }
      mesh.castShadow = kind !== 'snag' && kind !== 'causeway';
      mesh.receiveShadow = kind === 'block' || kind === 'wreckage';
      // The base geometry's bounding sphere says nothing about where the
      // instances are, so culling by it blanks the layer at some camera angles.
      mesh.frustumCulled = false;
      // These buffers change piecemeal all battle as ground is explored;
      // told they are static, a driver may stall revalidating each rewrite.
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.name = `props-${kind}`;

      const batchIndex = this.batches.length;
      for (let i = 0; i < placements.length; i += 1) {
        const entry = placements[i];
        if (entry === undefined) continue;
        const on = this.tileInstances.get(entry.tile);
        if (on === undefined) this.tileInstances.set(entry.tile, [[batchIndex, i]]);
        else on.push([batchIndex, i]);
      }

      this.batches.push({ mesh, placements });
      this.group.add(mesh);
    }
  }

  /** Hides props on unexplored tiles; exploration only ever grows, so this is
   *  a cheap count-compare almost every frame and a per-tile touch-up when it
   *  changes — never a rewrite of the whole map's scenery. */
  update(vision: TeamVision | null): void {
    let count = Number.MAX_SAFE_INTEGER;
    if (vision !== null) {
      count = 0;
      for (let i = 0; i < vision.explored.length; i += 1) count += vision.explored[i] ?? 0;
    }
    if (count === this.exploredCount) return;
    this.exploredCount = count;

    // The first look, or the shroud coming off entirely: sweep everything
    // once and take the snapshot the incremental path diffs against.
    if (vision === null || this.revealed === null) {
      for (const batch of this.batches) {
        for (let i = 0; i < batch.placements.length; i += 1) {
          const entry = batch.placements[i];
          if (entry === undefined) continue;
          const shown = vision === null || vision.explored[entry.tile] === 1;
          batch.mesh.setMatrixAt(i, shown ? entry.matrix : HIDDEN);
        }
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
      this.revealed = vision === null ? null : Uint8Array.from(vision.explored);
      return;
    }

    // Since exploration only grows, the change is exactly the tiles that
    // flipped since last time — reveal their props and upload only those
    // sixteen floats apiece.
    const previous = this.revealed;
    for (let tile = 0; tile < vision.explored.length; tile += 1) {
      if (vision.explored[tile] !== 1 || previous[tile] === 1) continue;
      previous[tile] = 1;
      const instances = this.tileInstances.get(tile);
      if (instances === undefined) continue;
      for (const [batchIndex, instanceIndex] of instances) {
        const batch = this.batches[batchIndex];
        const entry = batch?.placements[instanceIndex];
        if (batch === undefined || entry === undefined) continue;
        batch.mesh.setMatrixAt(instanceIndex, entry.matrix);
        batch.mesh.instanceMatrix.addUpdateRange(instanceIndex * 16, 16);
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
