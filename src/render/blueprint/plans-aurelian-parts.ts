import { PROFILES } from './profiles';
import { armoured, part, shaped } from './parts';
import type { BlueprintPart, Bones, LegJoint } from './types';

function jointed(piece: BlueprintPart, joint: LegJoint): BlueprintPart {
  return { ...piece, joint };
}

/** Three closed segments preserve the walking chain without showing its bearings. */
export function sealedWalkerLeg(
  parts: BlueprintPart[],
  b: Bones,
  side: number,
  boot: number,
  girth: number,
): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const drop = b.hip - b.kneeHeight;
  const thighTilt = Math.atan2(b.knee, Math.max(0.01, drop));
  const shinTilt = -Math.atan2(b.knee, Math.max(0.01, b.kneeHeight));

  parts.push(
    jointed(part(location, 'limb', [b.knee * 0.5, (b.hip + b.kneeHeight) / 2, z],
      [b.thigh * 1.24 * girth, Math.hypot(drop, b.knee), b.thigh * girth],
      'plate', thighTilt), 'hip'),
    jointed(part(location, 'limb', [b.knee * 0.5, b.kneeHeight * 0.5, z],
      [b.thigh * girth, Math.hypot(b.kneeHeight, b.knee), b.thigh * 1.14 * girth],
      'plate', shinTilt), 'knee'),
    jointed(shaped(location, PROFILES.foot, [boot * 0.22, 0.1, z],
      [boot, 0.2, b.thigh * 1.34 * girth], 'deep'), 'ankle'),
  );
}

/** The same closed skin follows a reversed knee without changing its planted arc. */
export function sealedBirdLeg(
  parts: BlueprintPart[],
  b: Bones,
  side: number,
  boot: number,
  girth: number,
): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const drop = b.hip - b.kneeHeight;
  const thighTilt = Math.atan2(b.knee, Math.max(0.01, drop));

  parts.push(
    jointed(part(location, 'limb', [b.knee * 0.5, (b.hip + b.kneeHeight) / 2, z],
      [b.thigh * 1.24 * girth, Math.hypot(drop, b.knee), b.thigh * 0.92 * girth],
      'plate', thighTilt), 'hip'),
    jointed(part(location, 'limb', [b.knee * 0.45, b.kneeHeight * 0.5, z],
      [b.thigh * 0.98 * girth, Math.hypot(b.kneeHeight, b.knee), b.thigh * 1.08 * girth],
      'plate', -Math.atan2(b.knee, Math.max(0.01, b.kneeHeight))), 'knee'),
    jointed(shaped(location, PROFILES.foot, [boot * 0.32, 0.08, z],
      [boot, 0.16, b.thigh * 1.2 * girth], 'deep'), 'ankle'),
  );
}

export function sealedHips(parts: BlueprintPart[], b: Bones, width: number): void {
  parts.push(shaped(null, PROFILES.wedge, [-b.long * 0.08, b.hip, 0],
    [b.long * 0.58, 0.26, b.spread * 2.08], 'deep'));
  for (const side of [-1, 1]) {
    parts.push(armoured(null, PROFILES.skirt,
      [b.long * 0.02, b.hip - 0.06, side * b.spread * 0.92],
      [b.long * 0.46, 0.42, b.thigh * width], 'plate',
      { front: 0.72, rear: 0.9, top: 0.76, bottom: 0.84, edge: 0.07 }));
  }
}
