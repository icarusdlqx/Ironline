import { BufferGeometry, ExtrudeGeometry, LatheGeometry, Shape, Vector2 } from 'three';

/**
 * A box with its edges taken off.
 *
 * A raw box is what makes generated machines look like toy bricks: every edge
 * is a hard black line and every face is one flat tone. Chamfering catches the
 * light along the edge instead, which is most of the difference between "boxy"
 * and "armour plate". The bevel is a fraction of the smallest dimension, so a
 * thin fin does not round away to nothing.
 */
export function chamferedBox(width: number, height: number, depth: number): BufferGeometry {
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
    bevelSegments: 2,
    curveSegments: 3,
  });
  // Extrude runs along +Z from zero; centre it so the part sits on its own origin.
  geometry.translate(0, 0, -(depth - depthBevel * 2) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A tapered limb segment: wider at the joint than at the end, with the corners
 * rounded off. Straight prisms are what make legs read as scaffolding.
 */
export function taperedLimb(top: number, bottom: number, length: number): BufferGeometry {
  const profile: Vector2[] = [];
  const steps = 8;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const radius = top + (bottom - top) * t;
    // Pinch the very ends so the segment has a shoulder rather than a flat cut.
    const pinch = Math.sin(Math.min(1, Math.min(t, 1 - t) * 6) * (Math.PI / 2));
    profile.push(new Vector2(Math.max(0.001, radius * (0.72 + 0.28 * pinch)), length / 2 - t * length));
  }
  const geometry = new LatheGeometry(profile, 7);
  geometry.computeVertexNormals();
  return geometry;
}
