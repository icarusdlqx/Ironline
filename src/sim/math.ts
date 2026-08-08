import type { Vec2 } from './types';

export const TAU = Math.PI * 2;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function bearing(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function normaliseAngle(angle: number): number {
  const wrapped = angle % TAU;
  if (wrapped > Math.PI) return wrapped - TAU;
  if (wrapped < -Math.PI) return wrapped + TAU;
  return wrapped;
}

export function angleDifference(from: number, to: number): number {
  return normaliseAngle(to - from);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}
