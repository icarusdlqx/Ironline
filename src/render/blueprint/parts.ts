import type { MechLocation } from '../../schema/common';
import { PROFILES } from './profiles';
import type {
  BlueprintPart,
  Bones,
  Fitting,
  HardpointCount,
  LegJoint,
  PartShape,
  Profile,
  Tone,
  TransverseTaper,
} from './types';

export function part(
  location: MechLocation | null,
  shape: PartShape,
  at: [number, number, number],
  size: [number, number, number],
  tone: Tone,
  tilt?: number,
): BlueprintPart {
  return tilt === undefined
    ? { location, shape, at, size, tone }
    : { location, shape, at, size, tone, tilt };
}

export function bolted(piece: BlueprintPart): BlueprintPart {
  return { ...piece, fixed: true };
}

function jointed(piece: BlueprintPart, joint: LegJoint): BlueprintPart {
  return { ...piece, joint };
}

export function shaped(
  location: MechLocation | null,
  profile: Profile,
  at: [number, number, number],
  size: [number, number, number],
  tone: Tone,
  tilt?: number,
): BlueprintPart {
  return { ...part(location, 'box', at, size, tone, tilt), profile };
}

export function armoured(
  location: MechLocation | null,
  profile: Profile,
  at: [number, number, number],
  size: [number, number, number],
  tone: Tone,
  transverse: TransverseTaper,
  tilt?: number,
): BlueprintPart {
  return { ...shaped(location, profile, at, size, tone, tilt), transverse };
}

export function fittingFor(counts: HardpointCount | undefined): Fitting {
  if (counts === undefined) return 'bare';
  if (counts.ballistic > 0) return 'cannon';
  if (counts.missile > 0) return 'launcher';
  if (counts.energy > 0) return 'emitter';
  return 'bare';
}

/** A straight load path is what makes a line mech look planted. */
export function walkerLeg(parts: BlueprintPart[], b: Bones, side: number, boot: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const t = b.thigh;

  parts.push(
    jointed(part(location, 'limb', [0, (b.hip + b.kneeHeight) / 2, z],
      [t * 1.18, b.hip - b.kneeHeight, t * 0.86], 'deep'), 'hip'),
    jointed(part(location, 'sphere', [0, b.kneeHeight, z],
      [t * 1.06, t * 1.06, t * 1.06], 'plate'), 'knee'),
    jointed(part(location, 'limb', [0, b.kneeHeight * 0.5, z],
      [t * 0.92, b.kneeHeight * 0.86, t * 1.02], 'plate'), 'knee'),
    jointed(part(location, 'sphere', [0, b.kneeHeight * 0.14, z],
      [t * 0.72, t * 0.72, t * 0.72], 'deep'), 'ankle'),
    jointed(shaped(location, PROFILES.foot, [boot * 0.24, 0.1, z],
      [boot, 0.2, t * 1.24], 'deep'), 'ankle'),
  );
}

/** Forward knees make speed legible before the machine moves. */
export function birdLeg(parts: BlueprintPart[], b: Bones, side: number, boot: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const t = b.thigh;
  const drop = b.hip - b.kneeHeight;
  const thighTilt = Math.atan2(b.knee, Math.max(0.01, drop));

  parts.push(
    jointed(part(location, 'limb', [b.knee * 0.5, (b.hip + b.kneeHeight) / 2, z],
      [t * 1.16, Math.hypot(drop, b.knee), t * 0.84], 'deep', thighTilt), 'hip'),
    jointed(part(location, 'sphere', [b.knee, b.kneeHeight, z],
      [t * 1.1, t * 1.1, t * 1.1], 'plate'), 'knee'),
    jointed(part(location, 'limb', [b.knee * 0.45, b.kneeHeight * 0.5, z],
      [t * 0.86, Math.hypot(b.kneeHeight, b.knee), t * 0.98], 'plate',
      -Math.atan2(b.knee, Math.max(0.01, b.kneeHeight))), 'knee'),
    jointed(part(location, 'sphere', [0, b.kneeHeight * 0.12, z],
      [t * 0.62, t * 0.62, t * 0.62], 'deep'), 'ankle'),
    jointed(shaped(location, PROFILES.foot, [boot * 0.3, 0.09, z],
      [boot, 0.18, t * 1.1], 'deep'), 'ankle'),
  );
}

export function hips(parts: BlueprintPart[], b: Bones, skirt = 1): void {
  parts.push(part(null, 'box', [0, b.hip, 0], [b.long * 0.52, 0.26, b.spread * 2.05], 'deep'));
  for (const side of [-1, 1]) {
    parts.push(shaped(null, PROFILES.skirt,
      [b.long * 0.04, b.hip - 0.05, side * b.spread * 0.95],
      [b.long * 0.5 * skirt, 0.44 * skirt, b.thigh * 0.55], 'plate'));
  }
}

export function radiators(parts: BlueprintPart[], b: Bones): void {
  for (const offset of [-0.3, 0, 0.3]) {
    parts.push(part('centre_torso', 'box',
      [-b.long * 0.42, b.tall * 0.5, offset * b.wide],
      [b.long * 0.32, b.tall * 0.3, 0.1], 'accent'));
  }
}

export function aerials(
  parts: BlueprintPart[],
  has: (trait: string) => boolean,
  x: number,
  y: number,
): void {
  if (has('sensor_mast')) {
    parts.push(
      part('head', 'box', [x, y + 0.03, 0], [0.16, 0.08, 0.16], 'deep'),
      part('head', 'cylinder', [x, y + 0.27, 0], [0.07, 0.44, 0.07], 'accent'),
      part('head', 'sphere', [x, y + 0.54, 0], [0.17, 0.17, 0.17], 'accent'),
    );
  }
  if (has('command_console')) {
    for (const side of [-1, 1]) {
      parts.push(part('head', 'box', [x, y + 0.18, side * 0.2], [0.09, 0.34, 0.07], 'accent'));
    }
  }
}

/** The loadout changes the structure carrying it, not just the muzzle. */
export function shoulderMount(
  parts: BlueprintPart[],
  b: Bones,
  side: number,
  fitting: Fitting,
  scale: number,
  out = 0.78,
  lift = 0.42,
): void {
  const location = side < 0 ? 'left_torso' : 'right_torso';
  const z = side * b.wide * out;
  const y = b.tall * lift;

  if (fitting === 'launcher') {
    parts.push(
      shaped(location, PROFILES.pod, [b.long * 0.06, y, z],
        [b.long * 0.62 * scale, b.tall * 0.56 * scale, b.wide * 0.42 * scale], 'plate', b.pitch),
      part(location, 'box', [b.long * 0.34 * scale + b.long * 0.06, y, z],
        [0.06, b.tall * 0.4 * scale, b.wide * 0.32 * scale], 'deep', b.pitch),
    );
    return;
  }
  if (fitting === 'cannon') {
    parts.push(
      shaped(location, PROFILES.block, [0, y, z],
        [b.long * 0.56 * scale, b.tall * 0.48 * scale, b.wide * 0.34 * scale], 'plate', b.pitch),
      part(location, 'cylinder', [-b.long * 0.26, y, z],
        [b.tall * 0.4 * scale, b.wide * 0.3 * scale, b.tall * 0.4 * scale], 'deep', Math.PI / 2),
    );
    return;
  }
  parts.push(
    shaped(location, PROFILES.block, [0, y, z],
      [b.long * 0.5 * scale, b.tall * 0.4 * scale, b.wide * 0.28 * scale], 'deep', b.pitch),
    part(location, 'box', [-b.long * 0.18, y + b.tall * 0.2 * scale, z],
      [b.long * 0.3, 0.08, b.wide * 0.24 * scale], 'accent'),
  );
}

/** Arms keep their joints while the forearm advertises what it feeds. */
export function hangingArm(
  parts: BlueprintPart[],
  b: Bones,
  side: number,
  fitting: Fitting,
  length: number,
  girth: number,
  pauldron = 1,
): void {
  const location = side < 0 ? 'left_arm' : 'right_arm';
  const z = side * b.shoulder;
  const top = b.tall * 0.28;

  parts.push(
    shaped(location, PROFILES.pauldron,
      [-b.long * 0.06, top + b.tall * 0.12 * pauldron, z * (1 + 0.06 * pauldron)],
      [b.long * 0.5 * pauldron, b.tall * 0.44 * pauldron, girth * 1.5 * pauldron], 'plate', b.pitch),
    part(location, 'sphere', [-b.long * 0.04, top, z], [girth * 1.25, girth * 1.25, girth * 1.25], 'deep'),
    part(location, 'limb', [-b.long * 0.02, top - length * 0.28, z], [girth * 1.1, length * 0.5, girth * 0.92], 'deep'),
    part(location, 'sphere', [0, top - length * 0.54, z], [girth, girth, girth], 'plate'),
  );

  const wristY = top - length * 0.82;
  if (fitting === 'cannon') {
    parts.push(
      part(location, 'box', [b.long * 0.04, wristY, z], [girth * 1.5, length * 0.46, girth * 1.5], 'plate'),
      part(location, 'box', [b.long * 0.04, wristY - length * 0.2, z], [girth * 1.2, 0.1, girth * 1.7], 'accent'),
    );
    return;
  }
  if (fitting === 'launcher') {
    parts.push(
      shaped(location, PROFILES.pod, [b.long * 0.02, wristY, z],
        [girth * 1.7, length * 0.44, girth * 1.6], 'plate'),
      part(location, 'box', [b.long * 0.02, wristY - length * 0.22, z], [girth * 1.2, 0.08, girth * 1.2], 'deep'),
    );
    return;
  }
  parts.push(
    part(location, 'limb', [0, wristY, z], [girth * 0.96, length * 0.44, girth * 1.16], 'plate'),
    part(location, 'box', [b.long * 0.04, wristY - length * 0.2, z], [girth * 1.3, girth * 0.9, girth * 1.3], 'deep'),
    part(location, 'box', [b.long * 0.12, wristY - length * 0.2, z], [0.06, girth * 0.5, girth * 0.7], 'glass'),
  );
}
