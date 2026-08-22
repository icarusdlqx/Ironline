import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Shape,
  Vector2,
} from 'three';
import type { Profile, TransverseTaper } from '../render/blueprint/types';
import type { MechGeometryQuality } from './renderQuality';

/**
 * A box with its edges taken off.
 *
 * A raw box is what makes generated machines look like toy bricks: every edge
 * is a hard black line and every face is one flat tone. Chamfering catches the
 * light along the edge instead, which is most of the difference between "boxy"
 * and "armour plate". The bevel is a fraction of the smallest dimension, so a
 * thin fin does not round away to nothing.
 */
export function chamferedBox(
  width: number,
  height: number,
  depth: number,
  quality: MechGeometryQuality = 'tactical',
): BufferGeometry {
  const bevel = Math.min(width, height, depth) * 0.22;
  const inset = Math.min(bevel, Math.min(width, height) / 2 - 0.001);

  // A rounded rectangle in the width/height plane, extruded through depth.
  const half = { x: width / 2 - inset, y: height / 2 - inset };
  const shape = new Shape();
  shape.moveTo(-half.x - inset, -half.y);
  shape.lineTo(-half.x - inset, half.y);
  shape.quadraticCurveTo(-half.x - inset, half.y + inset, -half.x, half.y + inset);
  shape.lineTo(half.x, half.y + inset);
  shape.quadraticCurveTo(half.x + inset, half.y + inset, half.x + inset, half.y);
  shape.lineTo(half.x + inset, -half.y);
  shape.quadraticCurveTo(half.x + inset, -half.y - inset, half.x, -half.y - inset);
  shape.lineTo(-half.x, -half.y - inset);
  shape.quadraticCurveTo(-half.x - inset, -half.y - inset, -half.x - inset, -half.y);

  const depthBevel = Math.min(bevel * 0.7, depth / 2 - 0.001);
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - depthBevel * 2,
    bevelEnabled: depthBevel > 0.0005,
    bevelThickness: depthBevel,
    bevelSize: depthBevel,
    bevelSegments: quality === 'hero' ? 3 : 2,
    curveSegments: quality === 'hero' ? 5 : 3,
  });
  // Extrude runs along +Z from zero; centre it so the part sits on its own origin.
  geometry.translate(0, 0, -(depth - depthBevel * 2) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A slab of armour with a shaped side profile, extruded across its width.
 *
 * A box has six faces meeting at right angles, and no amount of shading makes
 * that look like something a foundry built: what reads as armour is a sloped
 * glacis, a tapered deck, a cut corner. The profile is given in the part's own
 * units — x forward, y up — and the extrusion bevel does for the long edges
 * what the chamfer does for a box.
 *
 * Profiles must be convex. The bevel insets the outline, and an inset reflex
 * corner folds through itself.
 */
export function hullSlab(
  profile: readonly (readonly [number, number])[],
  depth: number,
  quality: MechGeometryQuality = 'tactical',
): BufferGeometry {
  const first = profile[0];
  if (first === undefined) throw new Error('a hull needs a profile');

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of profile) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const shape = new Shape();
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of profile.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  const bevel = Math.min(depth * 0.2, Math.min(maxX - minX, maxY - minY) * 0.14);
  const usable = Math.max(depth * 0.2, depth - bevel * 2);
  const geometry = new ExtrudeGeometry(shape, {
    depth: usable,
    bevelEnabled: bevel > 0.0005,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: quality === 'hero' ? 3 : 2,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -usable / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function span(profile: Profile): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of profile) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function factor(low: number, high: number, value: number): number {
  return low + (high - low) * value;
}

function anticlockwise(profile: Profile): Profile {
  let area = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const point = profile[index];
    const next = profile[(index + 1) % profile.length];
    if (point !== undefined && next !== undefined) area += point[0] * next[1] - next[0] * point[1];
  }
  // Several older decorative profiles predate the winding contract. Normalise
  // here so promoting one to armour cannot silently turn its faces inward.
  return area < 0 ? [...profile].reverse() : profile;
}

/**
 * A faceted armour shell whose width can change from tail to nose and keel to
 * crown. The clipped rim replaces a rounded extrusion bevel: it survives at
 * tactical zoom and keeps the triangle budget tied to the outline.
 */
export function armourShell(
  profile: Profile,
  depth: number,
  transverse: TransverseTaper,
): BufferGeometry {
  if (profile.length < 3) throw new Error('armour needs at least three profile points');
  const outline = anticlockwise(profile);
  const bounds = span(outline);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0 || depth <= 0) throw new Error('armour dimensions must be positive');

  const front = transverse.front ?? 1;
  const rear = transverse.rear ?? 1;
  const top = transverse.top ?? 1;
  const bottom = transverse.bottom ?? 1;
  const edge = transverse.edge ?? 0.08;
  if (Math.min(front, rear, top, bottom) <= 0 || edge < 0 || edge >= 0.5) {
    throw new Error('armour taper must leave a positive shell');
  }

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const edgeSize = Math.min(width, height, depth) * edge;
  const positions: number[] = [];
  const rings: [number[], number[], number[], number[]] = [[], [], [], []];

  for (const [ring, side, inset] of [
    [0, -1, true],
    [1, -1, false],
    [2, 1, false],
    [3, 1, true],
  ] as const) {
    for (const [x, y] of outline) {
      const along = (x - bounds.minX) / width;
      const rise = (y - bounds.minY) / height;
      const halfDepth = depth * 0.5
        * factor(rear, front, along)
        * factor(bottom, top, rise);
      const innerDepth = Math.max(halfDepth - edgeSize, halfDepth * 0.55);
      const dx = centreX - x;
      const dy = centreY - y;
      const distance = Math.hypot(dx, dy);
      const insetScale = inset && distance > 0 ? Math.min(edgeSize / distance, 0.24) : 0;
      rings[ring].push(positions.length / 3);
      positions.push(
        x + dx * insetScale,
        y + dy * insetScale,
        side * (inset ? halfDepth : innerDepth),
      );
    }
  }

  const indices: number[] = [];
  const count = outline.length;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const [negativeOuter, negativeInner, positiveInner, positiveOuter] = rings;
    indices.push(
      positiveInner[index]!, negativeInner[index]!, negativeInner[next]!,
      positiveInner[index]!, negativeInner[next]!, positiveInner[next]!,
      positiveInner[index]!, positiveInner[next]!, positiveOuter[next]!,
      positiveInner[index]!, positiveOuter[next]!, positiveOuter[index]!,
      negativeInner[index]!, negativeOuter[index]!, negativeOuter[next]!,
      negativeInner[index]!, negativeOuter[next]!, negativeInner[next]!,
    );
  }

  const addCap = (ring: number[], positive: boolean): void => {
    const centre = positions.length / 3;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const vertex of ring) {
      x += positions[vertex * 3] ?? 0;
      y += positions[vertex * 3 + 1] ?? 0;
      z += positions[vertex * 3 + 2] ?? 0;
    }
    positions.push(x / count, y / count, z / count);
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      indices.push(
        centre,
        positive ? ring[index]! : ring[next]!,
        positive ? ring[next]! : ring[index]!,
      );
    }
  };
  addCap(rings[0]!, false);
  addCap(rings[3]!, true);

  const indexed = new BufferGeometry();
  indexed.setAttribute('position', new Float32BufferAttribute(positions, 3));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A tapered limb segment: wider at the joint than at the end, with the corners
 * rounded off. Straight prisms are what make legs read as scaffolding.
 */
export function taperedLimb(
  top: number,
  bottom: number,
  length: number,
  quality: MechGeometryQuality = 'tactical',
): BufferGeometry {
  const profile: Vector2[] = [];
  const steps = quality === 'hero' ? 12 : 8;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const radius = top + (bottom - top) * t;
    // Pinch the very ends so the segment has a shoulder rather than a flat cut.
    const pinch = Math.sin(Math.min(1, Math.min(t, 1 - t) * 6) * (Math.PI / 2));
    profile.push(new Vector2(Math.max(0.001, radius * (0.72 + 0.28 * pinch)), length / 2 - t * length));
  }
  const geometry = new LatheGeometry(profile, quality === 'hero' ? 12 : 7);
  geometry.computeVertexNormals();
  return geometry;
}
