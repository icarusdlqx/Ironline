import type { Vec2 } from '../sim/types';

export interface TouchMove {
  previous: Vec2 | null;
  previousCentroid: Vec2 | null;
  centroid: Vec2 | null;
  span: number;
}

export interface TouchFinish {
  point: Vec2;
  commitTap: boolean;
}

/** Gesture-wide state keeps a pinch from turning its last finger into a tap. */
export class TouchGesture {
  private readonly points = new Map<number, Vec2>();
  private consumed = false;

  get size(): number {
    return this.points.size;
  }

  get suppressesTap(): boolean {
    return this.consumed;
  }

  start(pointerId: number, point: Vec2): number {
    if (this.points.size === 0) this.consumed = false;
    else this.consumed = true;
    this.points.set(pointerId, point);
    return this.points.size;
  }

  move(pointerId: number, point: Vec2): TouchMove {
    const previous = this.points.get(pointerId) ?? null;
    if (previous === null) {
      return { previous, previousCentroid: null, centroid: this.centroid(), span: this.span() };
    }
    const previousCentroid = this.centroid();
    this.points.set(pointerId, point);
    return {
      previous,
      previousCentroid,
      centroid: this.centroid(),
      span: this.span(),
    };
  }

  consume(): void {
    this.consumed = true;
  }

  finish(pointerId: number, fallback: Vec2): TouchFinish {
    const point = this.points.get(pointerId);
    if (point === undefined) return { point: fallback, commitTap: false };
    this.points.delete(pointerId);
    const commitTap = this.points.size === 0 && !this.consumed;
    if (this.points.size === 0) this.consumed = false;
    return { point, commitTap };
  }

  cancel(pointerId: number): void {
    this.consumed = true;
    this.points.delete(pointerId);
    if (this.points.size === 0) this.consumed = false;
  }

  reset(): void {
    this.points.clear();
    this.consumed = false;
  }

  span(): number {
    const [a, b] = [...this.points.values()];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  centroid(): Vec2 | null {
    if (this.points.size === 0) return null;
    let x = 0;
    let y = 0;
    for (const point of this.points.values()) {
      x += point.x;
      y += point.y;
    }
    return { x: x / this.points.size, y: y / this.points.size };
  }
}
