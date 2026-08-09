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

/**
 * A side profile in units of the part's own size: x forward, y up, each running
 * -0.5 to 0.5. A plate given one is extruded across its width to that outline
 * rather than being a box, which is how a hull gets a sloped glacis and a
 * tapered deck instead of six faces at right angles.
 *
 * Must be convex and wound anticlockwise.
 */
export type Profile = readonly (readonly [number, number])[];

export interface BlueprintPart {
  /** Which structural location this belongs to, so damage can grey it out. */
  location: MechLocation | null;
  shape: PartShape;
  at: [number, number, number];
  size: [number, number, number];
  tone: Tone;
  /** Lean about the lateral axis, in radians. Positive pitches the nose down. */
  tilt?: number;
  /** Shaped side view. A plain rectangle when absent. */
  profile?: Profile;
}

/**
 * The outlines the hulls are cut to. Named for what they are on the machine,
 * because that is how they get reused: a glacis is a glacis whether it is on a
 * chest or a shoulder.
 */
const PROFILES = {
  /** Sloped nose, tapered deck, cut-away rear. A hull, not a crate. */
  hull: [
    [-0.5, -0.42],
    [0.34, -0.5],
    [0.5, -0.18],
    [0.38, 0.36],
    [0.16, 0.5],
    [-0.42, 0.5],
    [-0.5, 0.2],
  ],
  /** A cockpit: flat floor, raked canopy, blunt back. */
  canopy: [
    [-0.5, -0.5],
    [0.5, -0.42],
    [0.5, 0.04],
    [0.02, 0.5],
    [-0.5, 0.5],
  ],
  /** Armour that overhangs: thick at the top, drawn back underneath. */
  pauldron: [
    [-0.42, -0.36],
    [0.3, -0.5],
    [0.5, -0.05],
    [0.34, 0.5],
    [-0.5, 0.42],
  ],
  /** A skirt plate over a hip, angled so the leg swings clear of it. */
  skirt: [
    [-0.5, 0.5],
    [0.5, 0.32],
    [0.34, -0.5],
    [-0.34, -0.5],
  ],
  /** A shoulder weapon block, chopped at the front so the muzzles clear it. */
  block: [
    [-0.5, -0.5],
    [0.32, -0.5],
    [0.5, -0.16],
    [0.5, 0.24],
    [0.3, 0.5],
    [-0.5, 0.5],
  ],
} as const satisfies Record<string, Profile>;

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

/** A plate cut to a shaped outline rather than left as a box. */
function shaped(
  location: MechLocation | null,
  profile: Profile,
  at: [number, number, number],
  size: [number, number, number],
  tone: Tone,
  tilt?: number,
): BlueprintPart {
  const base = part(location, 'box', at, size, tone, tilt);
  return { ...base, profile };
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
  squat: { leg: 1.12, hip: 0.58, knee: 0, long: 1.0, wide: 1.12, tall: 0.7, pitch: 0, shoulder: 0.9, arms: true },
  // A gun emplacement that walks. Short legs under a slab of armour — but
  // still legs: the heavy chassis take a leg multiplier well under one, and a
  // low base on top of that leaves a hull sitting on its own feet.
  siege: { leg: 1.3, hip: 0.62, knee: -0.05, long: 1.15, wide: 1.2, tall: 0.78, pitch: 0, shoulder: 1.0, arms: false },
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
  // A hundred tonnes cannot stand on a scout's shins: leg mass tracks hull
  // width, but only so far. Past the cap the thigh gets thicker than it is
  // long and the machine stops reading as something that walks.
  const thighT = (has('reinforced_legs') ? 0.4 : 0.32) * Math.min(1.2, 0.55 + frame.wide * 0.5);
  const digitigrade = frame.knee > 0.2;

  // ------------------------------------------------------------------- legs
  for (const side of [-1, 1]) {
    const z = side * frame.hip;
    parts.push(
      part(side < 0 ? 'left_leg' : 'right_leg', 'limb',
        [-frame.knee * 0.5, frame.leg * 0.72, z],
        [thighT * 1.15, frame.leg * 0.62, thighT * 0.82], 'deep'),
      // Knee, which is what tells the eye which way the leg bends. Painted
      // like the plate around it: a bright joint reads as a bearing left
      // exposed, and four of them per mech is all anyone looks at.
      part(side < 0 ? 'left_leg' : 'right_leg', 'sphere',
        [frame.knee * 0.1, frame.leg * 0.46, z],
        [thighT * 1.05, thighT * 1.05, thighT * 1.05], 'plate'),
      part(side < 0 ? 'left_leg' : 'right_leg', 'limb',
        [frame.knee * 0.5, frame.leg * 0.26, z],
        [thighT * 0.9, frame.leg * 0.56, thighT * 1.05], 'plate'),
      // Foot. A digitigrade frame stands on a long splayed pad; a walker on a
      // boot. Deep enough to be a foot rather than a board laid on the ground.
      part(side < 0 ? 'left_leg' : 'right_leg', 'box',
        [frame.knee + (digitigrade ? 0.16 : 0.04), 0.09, z],
        [digitigrade ? 0.62 : 0.46, 0.18, thighT * 1.15], 'deep'),
    );
  }
  // Hips, which is what makes a wide stance read as wide.
  parts.push(part(null, 'box', [0, frame.leg, 0], [frame.long * 0.5, 0.24, frame.hip * 2.1], 'deep'));
  // Skirt plates over the hips. Armour that hangs is the cheapest way to stop a
  // mech looking like a crate balanced on two poles.
  for (const side of [-1, 1]) {
    parts.push(shaped(null, PROFILES.skirt,
      [frame.long * 0.04, frame.leg - 0.06, side * frame.hip * 0.92],
      [frame.long * 0.46, 0.42, thighT * 0.55], 'plate'));
  }

  // ------------------------------------------------------------------ torso
  // Cut to a hull outline rather than left as a box: a sloped nose, a deck that
  // tapers back, a chamfered rear. Six faces at right angles is what reads as a
  // stack of bricks however carefully it is lit.
  parts.push(shaped('centre_torso', PROFILES.hull, [0, 0, 0],
    [frame.long, frame.tall, frame.wide], 'plate', frame.pitch));

  // Side torsos, stepped out so the hull is not one slab.
  for (const side of [-1, 1]) {
    parts.push(shaped(side < 0 ? 'left_torso' : 'right_torso', PROFILES.block,
      [-frame.long * 0.08, frame.tall * 0.06, side * frame.wide * 0.56],
      [frame.long * 0.82, frame.tall * 0.78, frame.wide * 0.3], 'deep', frame.pitch));
  }

  // Panel breaks across the chest. Two thin strips proud of the plate is
  // nothing on its own and is most of what separates a machine somebody built
  // from a shape somebody extruded.
  for (const level of [0.3, -0.24]) {
    parts.push(part('centre_torso', 'box',
      [frame.long * 0.3, frame.tall * level, 0],
      [frame.long * 0.34, frame.tall * 0.12, frame.wide * 0.86], 'deep', frame.pitch));
  }
  // A vent block low on the flank, where the sinks would breathe.
  for (const side of [-1, 1]) {
    parts.push(part(side < 0 ? 'left_torso' : 'right_torso', 'box',
      [-frame.long * 0.3, -frame.tall * 0.22, side * frame.wide * 0.6],
      [frame.long * 0.3, frame.tall * 0.26, 0.08], 'accent', frame.pitch));
  }

  if (has('hardened_mantlet')) {
    // A slab of frontal armour, and the whole reason these things survive.
    parts.push(shaped('centre_torso', PROFILES.pauldron,
      [frame.long * 0.5, frame.tall * 0.05, 0],
      [0.24, frame.tall * 1.05, frame.wide * 1.02], 'trim', frame.pitch));
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
    // A cockpit, raked back over a flat floor, with the canopy set into it.
    shaped('head', PROFILES.canopy, [headX, headY, 0], [0.48, 0.36, 0.46], 'deep'),
    part('head', 'box', [headX + 0.16, headY + 0.02, 0], [0.12, 0.17, 0.3], 'glass'),
    // Brow plate. The cockpit is the one part a player looks at to tell which
    // way a mech is facing, so it gets an edge.
    part('head', 'box', [headX + 0.02, headY + 0.19, 0], [0.34, 0.08, 0.4], 'plate'),
  );

  // Masts and aerials are kept short. They are a marking on the machine, not a
  // second machine: a tall one pushes the frame up until the mech under it is
  // drawn half size to fit.
  if (has('sensor_mast')) {
    parts.push(
      part('head', 'cylinder', [headX - 0.2, headY + 0.36, 0], [0.07, 0.5, 0.07], 'accent'),
      part('head', 'sphere', [headX - 0.2, headY + 0.66, 0], [0.18, 0.18, 0.18], 'accent'),
    );
  }
  if (has('command_console')) {
    for (const side of [-1, 1]) {
      parts.push(part('head', 'box',
        [headX - 0.3, headY + 0.28, side * 0.22], [0.09, 0.36, 0.07], 'accent'));
    }
  }

  // ------------------------------------------------------------------- arms
  if (frame.arms) {
    for (const side of [-1, 1]) {
      const z = side * frame.shoulder;
      parts.push(
        // Pauldron over the shoulder joint, overhanging it the way armour does.
        shaped(side < 0 ? 'left_arm' : 'right_arm', PROFILES.pauldron,
          [-frame.long * 0.1, frame.tall * 0.34, z * 1.04],
          [frame.long * 0.52, frame.tall * 0.4, 0.34], 'plate', frame.pitch),
        part(side < 0 ? 'left_arm' : 'right_arm', 'sphere',
          [-frame.long * 0.16, frame.tall * 0.14, z], [0.32, 0.32, 0.32], 'deep'),
        part(side < 0 ? 'left_arm' : 'right_arm', 'limb',
          [frame.long * 0.18, -frame.tall * 0.05, z], [0.34, frame.long * 0.7, 0.26], 'deep', Math.PI / 2),
        // A forearm plate, so the arm is not one smooth tube.
        part(side < 0 ? 'left_arm' : 'right_arm', 'box',
          [frame.long * 0.3, -frame.tall * 0.02, z], [frame.long * 0.28, 0.2, 0.3], 'plate'),
      );
    }
  } else {
    // No arms: the weapons hang off shoulder blocks instead.
    for (const side of [-1, 1]) {
      parts.push(
        shaped(side < 0 ? 'left_arm' : 'right_arm', PROFILES.block,
          [-frame.long * 0.02, frame.tall * 0.3, side * frame.shoulder],
          [frame.long * 0.6, frame.tall * 0.44, 0.34], 'plate', frame.pitch),
        // A cap over the block, stepped in, so the shoulder has a top edge.
        part(side < 0 ? 'left_arm' : 'right_arm', 'box',
          [-frame.long * 0.08, frame.tall * 0.54, side * frame.shoulder],
          [frame.long * 0.4, 0.1, 0.28], 'deep', frame.pitch),
      );
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
