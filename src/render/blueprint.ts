import type { MechLocation } from '../schema/common';
import type { Silhouette } from './shape';

/**
 * How a chassis is built, in one place, so the battlefield and the mechbay
 * never disagree about what a machine looks like. Everything is in radius
 * units — one unit is the chassis radius — with x forward toward the nose,
 * y up, and z out to the mech's right.
 */
export type Tone = 'plate' | 'deep' | 'trim' | 'glass' | 'accent';

/**
 * `limb` is a tapered segment — wider at the joint than at the end. Straight
 * prisms are what make legs read as scaffolding rather than as a machine that
 * carries its own weight.
 */
export type PartShape = 'box' | 'cylinder' | 'sphere' | 'limb';

export interface BlueprintPart {
  /** Which structural location this belongs to, so damage can grey it out. */
  location: MechLocation | null;
  shape: PartShape;
  at: [number, number, number];
  size: [number, number, number];
  tone: Tone;
  /** Lean about the lateral axis, in radians. Positive pitches the nose down. */
  tilt?: number;
}

export interface Blueprint {
  parts: BlueprintPart[];
  /** Where a weapon carried in each location is bolted. */
  hardpoints: Partial<Record<MechLocation, [number, number, number]>>;
  /** Height of the torso pivot, and the whole machine, in radius units. */
  torsoY: number;
  height: number;
}

function part(
  location: MechLocation | null,
  shape: PartShape,
  at: [number, number, number],
  size: [number, number, number],
  tone: Tone,
  tilt?: number,
): BlueprintPart {
  return tilt === undefined ? { location, shape, at, size, tone } : { location, shape, at, size, tone, tilt };
}

/** Proportions each body plan works from. Everything else is derived. */
interface Frame {
  /** Leg length, hip spread and how far the knee is thrown forward or back. */
  leg: number;
  hip: number;
  knee: number;
  /** Torso length, width, height, and how far it pitches forward. */
  long: number;
  wide: number;
  tall: number;
  pitch: number;
  /** How far the shoulders sit out, and whether the mech has real arms. */
  shoulder: number;
  arms: boolean;
}

const FRAMES: Record<Silhouette['form'], Frame> = {
  // Small, hunched, up on its toes. Nothing on it is meant to trade fire.
  scout: { leg: 1.15, hip: 0.34, knee: 0.3, long: 0.85, wide: 0.62, tall: 0.6, pitch: 0.22, shoulder: 0.46, arms: false },
  // Reverse-jointed and pitched forward, built around the stride.
  bird: { leg: 1.3, hip: 0.4, knee: 0.36, long: 1.05, wide: 0.72, tall: 0.66, pitch: 0.3, shoulder: 0.58, arms: false },
  // Upright, even, and armed like a soldier. The shape everything else is read against.
  humanoid: { leg: 1.0, hip: 0.42, knee: 0.06, long: 0.95, wide: 0.86, tall: 0.86, pitch: 0.04, shoulder: 0.72, arms: true },
  // Low and planted, all width. Made to stand somewhere and not be moved.
  squat: { leg: 0.95, hip: 0.58, knee: 0, long: 1.0, wide: 1.12, tall: 0.7, pitch: 0, shoulder: 0.9, arms: true },
  // A gun emplacement that walks. Barely legs at all under a slab of armour.
  siege: { leg: 1.05, hip: 0.62, knee: -0.05, long: 1.15, wide: 1.2, tall: 0.78, pitch: 0, shoulder: 1.0, arms: false },
};

/**
 * Builds a chassis from its body plan, then lets its traits mark it: a sensor
 * mast, a command array, a hardened mantlet and oversized sinks are all things
 * the lore says about a machine, and all things you should be able to see.
 */
export function chassisBlueprint(shape: Silhouette, traits: readonly string[]): Blueprint {
  const base = FRAMES[shape.form];
  const has = (trait: string): boolean => traits.includes(trait);

  const frame: Frame = {
    ...base,
    leg: base.leg * shape.legLength * (has('long_stride') ? 1.12 : 1),
    hip: base.hip * shape.stance * (has('wide_stance') ? 1.25 : 1),
    long: base.long * shape.torsoLength,
    wide: base.wide * shape.torsoWidth * (has('narrow_profile') ? 0.82 : 1),
    tall: base.tall,
    shoulder: base.shoulder * shape.shoulder,
  };

  const parts: BlueprintPart[] = [];
  // A hundred tonnes cannot stand on a scout's shins: leg mass tracks hull width.
  const thighT = (has('reinforced_legs') ? 0.4 : 0.32) * (0.55 + frame.wide * 0.5);
  const digitigrade = frame.knee > 0.2;

  // ------------------------------------------------------------------- legs
  for (const side of [-1, 1]) {
    const z = side * frame.hip;
    parts.push(
      part(side < 0 ? 'left_leg' : 'right_leg', 'limb',
        [-frame.knee * 0.5, frame.leg * 0.72, z],
        [thighT * 1.15, frame.leg * 0.62, thighT * 0.82], 'deep'),
      // Knee, which is what tells the eye which way the leg bends.
      part(side < 0 ? 'left_leg' : 'right_leg', 'sphere',
        [frame.knee * 0.1, frame.leg * 0.46, z],
        [thighT * 1.05, thighT * 1.05, thighT * 1.05], 'accent'),
      part(side < 0 ? 'left_leg' : 'right_leg', 'limb',
        [frame.knee * 0.5, frame.leg * 0.26, z],
        [thighT * 0.9, frame.leg * 0.56, thighT * 1.05], 'plate'),
      // Foot. A digitigrade frame stands on a long splayed pad; a walker on a boot.
      part(side < 0 ? 'left_leg' : 'right_leg', 'box',
        [frame.knee + (digitigrade ? 0.16 : 0.04), 0.06, z],
        [digitigrade ? 0.62 : 0.46, 0.12, thighT * 1.15], 'deep'),
    );
  }
  // Hips, which is what makes a wide stance read as wide.
  parts.push(part(null, 'box', [0, frame.leg, 0], [frame.long * 0.5, 0.24, frame.hip * 2.1], 'deep'));

  // ------------------------------------------------------------------ torso
  parts.push(part('centre_torso', 'box', [0, 0, 0], [frame.long, frame.tall, frame.wide], 'plate', frame.pitch));

  // Side torsos, stepped out so the hull is not one slab.
  for (const side of [-1, 1]) {
    parts.push(part(side < 0 ? 'left_torso' : 'right_torso', 'box',
      [-frame.long * 0.08, frame.tall * 0.06, side * frame.wide * 0.56],
      [frame.long * 0.82, frame.tall * 0.78, frame.wide * 0.3], 'deep', frame.pitch));
  }

  if (has('hardened_mantlet')) {
    // A slab of frontal armour, and the whole reason these things survive.
    parts.push(part('centre_torso', 'box',
      [frame.long * 0.52, frame.tall * 0.05, 0],
      [0.18, frame.tall * 1.05, frame.wide * 1.02], 'trim', frame.pitch));
  }

  if (has('oversized_sinks')) {
    // Radiator banks down the spine. You can see what it is paying for.
    for (const offset of [-0.3, 0, 0.3]) {
      parts.push(part('centre_torso', 'box',
        [-frame.long * 0.42, frame.tall * 0.52, offset * frame.wide],
        [frame.long * 0.34, frame.tall * 0.3, 0.1], 'accent'));
    }
  }

  // ------------------------------------------------------------------- head
  const headX = digitigrade ? frame.long * 0.44 : frame.long * 0.3;
  const headY = frame.tall * 0.62 + 0.16;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.42, 0.32, 0.44], 'deep'),
    part('head', 'sphere', [headX + 0.14, headY, 0], [0.2, 0.2, 0.2], 'glass'),
  );

  if (has('sensor_mast')) {
    parts.push(
      part('head', 'cylinder', [headX - 0.2, headY + 0.55, 0], [0.05, 0.9, 0.05], 'accent'),
      part('head', 'sphere', [headX - 0.2, headY + 1.0, 0], [0.16, 0.16, 0.16], 'accent'),
    );
  }
  if (has('command_console')) {
    for (const side of [-1, 1]) {
      parts.push(part('head', 'box',
        [headX - 0.3, headY + 0.4, side * 0.22], [0.08, 0.6, 0.06], 'accent'));
    }
  }

  // ------------------------------------------------------------------- arms
  if (frame.arms) {
    for (const side of [-1, 1]) {
      const z = side * frame.shoulder;
      parts.push(
        part(side < 0 ? 'left_arm' : 'right_arm', 'sphere',
          [-frame.long * 0.16, frame.tall * 0.2, z], [0.4, 0.4, 0.4], 'plate'),
        part(side < 0 ? 'left_arm' : 'right_arm', 'limb',
          [frame.long * 0.18, -frame.tall * 0.05, z], [0.34, frame.long * 0.7, 0.26], 'deep', Math.PI / 2),
      );
    }
  } else {
    // No arms: the weapons hang off shoulder blocks instead.
    for (const side of [-1, 1]) {
      parts.push(part(side < 0 ? 'left_arm' : 'right_arm', 'box',
        [-frame.long * 0.02, frame.tall * 0.3, side * frame.shoulder],
        [frame.long * 0.6, frame.tall * 0.44, 0.34], 'plate', frame.pitch));
    }
  }

  const hardpoints: Blueprint['hardpoints'] = {
    left_arm: [frame.long * 0.42, frame.arms ? -frame.tall * 0.05 : frame.tall * 0.3, -frame.shoulder],
    right_arm: [frame.long * 0.42, frame.arms ? -frame.tall * 0.05 : frame.tall * 0.3, frame.shoulder],
    left_torso: [frame.long * 0.3, frame.tall * 0.3, -frame.wide * 0.56],
    right_torso: [frame.long * 0.3, frame.tall * 0.3, frame.wide * 0.56],
    centre_torso: [frame.long * 0.42, frame.tall * 0.42, 0],
    head: [headX, headY + 0.24, 0],
  };

  return {
    parts,
    hardpoints,
    torsoY: frame.leg + frame.tall * 0.5,
    height: frame.leg + frame.tall * 1.4,
  };
}
