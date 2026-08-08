import type { TerrainGrid } from './terrain';
import type { Vec2 } from './types';

const DIAGONAL_COST = Math.SQRT2;

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, DIAGONAL_COST],
  [1, -1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST],
  [-1, -1, DIAGONAL_COST],
];

interface OpenNode {
  cell: number;
  f: number;
}

class MinHeap {
  private readonly items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  push(node: OpenNode): void {
    this.items.push(node);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.lessThan(child, parent)) break;
      this.swap(child, parent);
      child = parent;
    }
  }

  pop(): OpenNode | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && this.lessThan(left, smallest)) smallest = left;
        if (right < this.items.length && this.lessThan(right, smallest)) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  // Cell index breaks f-score ties so expansion order never depends on insertion timing.
  private lessThan(a: number, b: number): boolean {
    const left = this.items[a] as OpenNode;
    const right = this.items[b] as OpenNode;
    if (left.f !== right.f) return left.f < right.f;
    return left.cell < right.cell;
  }

  private swap(a: number, b: number): void {
    const held = this.items[a] as OpenNode;
    this.items[a] = this.items[b] as OpenNode;
    this.items[b] = held;
  }
}

interface Scratch {
  size: number;
  cost: Float64Array;
  from: Int32Array;
  stamp: Int32Array;
  generation: number;
  heap: MinHeap;
}

let scratch: Scratch | null = null;

function getScratch(size: number): Scratch {
  if (scratch === null || scratch.size !== size) {
    scratch = {
      size,
      cost: new Float64Array(size),
      from: new Int32Array(size),
      stamp: new Int32Array(size),
      generation: 0,
      heap: new MinHeap(),
    };
  }
  scratch.generation += 1;
  scratch.heap.clear();
  return scratch;
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? ax - ay + DIAGONAL_COST * ay : ay - ax + DIAGONAL_COST * ax;
}

export function nearestPassable(
  grid: TerrainGrid,
  column: number,
  row: number,
  maxRadius: number,
): { column: number; row: number } | null {
  if (grid.passable(column, row)) return { column, row };

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let offsetRow = -radius; offsetRow <= radius; offsetRow += 1) {
      for (let offsetColumn = -radius; offsetColumn <= radius; offsetColumn += 1) {
        if (Math.max(Math.abs(offsetRow), Math.abs(offsetColumn)) !== radius) continue;
        const candidateColumn = column + offsetColumn;
        const candidateRow = row + offsetRow;
        if (grid.passable(candidateColumn, candidateRow)) {
          return { column: candidateColumn, row: candidateRow };
        }
      }
    }
  }
  return null;
}

export function findPath(
  grid: TerrainGrid,
  start: Vec2,
  goal: Vec2,
  maxNodes: number,
): Vec2[] | null {
  const startTile = grid.toTile(start);
  const rawGoal = grid.toTile(goal);
  const goalTile = nearestPassable(grid, rawGoal.column, rawGoal.row, 4);

  if (goalTile === null) return null;
  if (!grid.inBounds(startTile.column, startTile.row)) return null;

  const startCell = startTile.row * grid.width + startTile.column;
  const goalCell = goalTile.row * grid.width + goalTile.column;
  if (startCell === goalCell) return [];

  const state = getScratch(grid.width * grid.height);
  const { cost, from, stamp, heap, generation } = state;

  cost[startCell] = 0;
  from[startCell] = -1;
  stamp[startCell] = generation;
  heap.push({ cell: startCell, f: octile(goalTile.column - startTile.column, goalTile.row - startTile.row) * grid.minStepCost });

  let expanded = 0;

  while (heap.size > 0) {
    const current = heap.pop();
    if (current === undefined) break;

    const cell = current.cell;
    if (cell === goalCell) {
      const exact = rawGoal.column === goalTile.column && rawGoal.row === goalTile.row;
      return reconstruct(grid, from, startCell, goalCell, exact ? goal : null);
    }

    expanded += 1;
    if (expanded > maxNodes) return null;

    const column = cell % grid.width;
    const row = (cell - column) / grid.width;
    const currentCost = cost[cell] ?? 0;

    for (const [offsetColumn, offsetRow, stepCost] of NEIGHBOURS) {
      const nextColumn = column + offsetColumn;
      const nextRow = row + offsetRow;
      if (!grid.passable(nextColumn, nextRow)) continue;

      if (
        offsetColumn !== 0 &&
        offsetRow !== 0 &&
        (!grid.passable(column + offsetColumn, row) || !grid.passable(column, row + offsetRow))
      ) {
        continue;
      }

      const nextCell = nextRow * grid.width + nextColumn;
      const terrain = grid.typeAt(nextColumn, nextRow);
      const nextCost = currentCost + stepCost / terrain.moveMultiplier;

      if (stamp[nextCell] === generation && nextCost >= (cost[nextCell] ?? 0)) continue;

      stamp[nextCell] = generation;
      cost[nextCell] = nextCost;
      from[nextCell] = cell;
      const heuristic =
        octile(goalTile.column - nextColumn, goalTile.row - nextRow) * grid.minStepCost;
      heap.push({ cell: nextCell, f: nextCost + heuristic });
    }
  }

  return null;
}

function reconstruct(
  grid: TerrainGrid,
  from: Int32Array,
  startCell: number,
  goalCell: number,
  goal: Vec2 | null,
): Vec2[] {
  const cells: number[] = [];
  let cell = goalCell;
  while (cell !== startCell && cell >= 0) {
    cells.push(cell);
    cell = from[cell] ?? -1;
  }
  cells.reverse();

  const waypoints = cells.map((entry) => {
    const column = entry % grid.width;
    const row = (entry - column) / grid.width;
    return grid.tileCentre(column, row);
  });

  if (goal !== null && waypoints.length > 0) {
    waypoints[waypoints.length - 1] = { x: goal.x, y: goal.y };
  }
  return waypoints;
}
