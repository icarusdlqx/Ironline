import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { TerrainGrid } from '../sim/terrain';
import type { TeamVision } from '../sim/sensors';
import { disposeObjectResources } from './sceneResources';

/** How far above the ground the shroud floats, to keep it off the terrain. */
const LIFT = 0.6;

const UNSEEN = 1;
const REMEMBERED = 0.62;
const VISIBLE = 0;

/** The four corners of a tile, hoisted: this runs for every lit tile. */
const TILE_CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

/**
 * The shroud is a second skin over the terrain, black, with its opacity carried
 * per corner. Ground nobody has walked is solid; ground the lance has seen and
 * left is dimmed; ground under sensors is clear. One buffer update a frame is
 * cheaper than rebuilding the terrain's own colours.
 */
export class FogLayer {
  readonly mesh: Mesh;

  private readonly alphas: Float32Array;
  private readonly across: number;
  private readonly colours: BufferAttribute;

  constructor(grid: TerrainGrid, heightAt: (x: number, y: number) => number) {
    const size = grid.tileSize;
    this.across = grid.width + 1;
    const down = grid.height + 1;
    const corners = this.across * down;

    const positions = new Float32Array(corners * 3);
    const colours = new Float32Array(corners * 4);
    this.alphas = new Float32Array(corners);

    for (let row = 0; row < down; row += 1) {
      for (let column = 0; column < this.across; column += 1) {
        const index = row * this.across + column;
        positions[index * 3] = column * size;
        positions[index * 3 + 1] = heightAt(column * size, row * size) + LIFT;
        positions[index * 3 + 2] = row * size;
        colours[index * 4 + 3] = UNSEEN;
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const a = row * this.across + column;
        const b = a + 1;
        const c = a + this.across;
        indices.push(a, c, b, b, c, c + 1);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.colours = new BufferAttribute(colours, 4);
    // Rewritten whenever the lance moves; a driver told it is static may
    // stall revalidating the rewrite instead of streaming it.
    this.colours.setUsage(DynamicDrawUsage);
    geometry.setAttribute('color', this.colours);
    geometry.setIndex(indices);

    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.mesh.renderOrder = 2;
    this.mesh.name = 'fog';
  }

  update(grid: TerrainGrid, vision: TeamVision | null): void {
    if (vision === null) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Corner opacity is the clearest of the tiles that meet there, so the edge
    // of what the lance can see is a soft line rather than a staircase.
    for (let index = 0; index < this.alphas.length; index += 1) this.alphas[index] = UNSEEN;

    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const cell = row * grid.width + column;
        const alpha =
          vision.tiles[cell] === 1 ? VISIBLE : vision.explored[cell] === 1 ? REMEMBERED : UNSEEN;
        if (alpha === UNSEEN) continue;

        for (const [dx, dy] of TILE_CORNERS) {
          const corner = (row + dy) * this.across + (column + dx);
          const current = this.alphas[corner];
          if (current !== undefined && alpha < current) this.alphas[corner] = alpha;
        }
      }
    }

    // Only touch the GPU when the shroud actually changed shape: most ticks
    // of a still battlefield shade out exactly as they did last tick.
    const array = this.colours.array as Float32Array;
    let changed = false;
    for (let index = 0; index < this.alphas.length; index += 1) {
      const alpha = this.alphas[index] ?? UNSEEN;
      if (array[index * 4 + 3] !== alpha) {
        array[index * 4 + 3] = alpha;
        changed = true;
      }
    }
    if (changed) this.colours.needsUpdate = true;
  }

  dispose(): void {
    disposeObjectResources(this.mesh);
  }
}
