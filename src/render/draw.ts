import type { Graphics } from 'pixi.js';

interface StrokeStyle {
  width: number;
  color: number;
  alpha: number;
}

interface FillStyle {
  color: number;
  alpha: number;
}

/**
 * A stroked arc, on its own path.
 *
 * `arc()` inherits the Canvas rule that it joins the current point to the arc's
 * start, so an arc drawn straight onto a Graphics that has been used already
 * trails a line back to wherever the pen happened to be — which, in a layer
 * shared by every mech on the field, is another mech somewhere off screen.
 * Always start the path on the circumference.
 */
export function strokeArc(
  graphics: Graphics,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  style: StrokeStyle,
): void {
  graphics
    .moveTo(cx + Math.cos(from) * radius, cy + Math.sin(from) * radius)
    .arc(cx, cy, radius, from, to)
    .stroke(style);
}

/** A filled pie slice: centre, out along the arc, and back to the centre. */
export function fillWedge(
  graphics: Graphics,
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  style: FillStyle,
): void {
  graphics
    .moveTo(cx, cy)
    .arc(cx, cy, radius, from, to)
    .lineTo(cx, cy)
    .fill(style);
}
