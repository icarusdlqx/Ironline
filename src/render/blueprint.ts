import type { MechLocation } from '../schema/common';
import type { Silhouette } from './shape';

/**
 * How a chassis is built, in one place, so the battlefield and the mechbay
 * never disagree about what a machine looks like. Everything is in radius
 * units — one unit is the chassis radius — with x forward toward the nose,
 * y up, and z out to the mech's right.
 *
 * Each body plan is authored on its own rather than being one shape with the
 * numbers turned up or down. Two machines that differ only in scale read as
 * the same machine twice, however carefully the proportions are tuned, so a
 * Colossus is built as a hunched siege hull with a face and a Timberwolf as a
 * forward-slung pod carrier on reversed legs, and neither shares a line of
 * construction with the other.
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
  /**
   * Stays with the hull rather than turning with the guns. A vehicle's glacis
   * belongs to the centre torso structurally and to the chassis visually, and
   * a turret that took the whole hull round with it would look like a mech.
   */
  fixed?: boolean;
  /** Shaped side view. A plain rectangle when absent. */
  profile?: Profile;
}

/** What a location is wired to carry, which is what its structure is built for. */
export interface HardpointCount {
  energy: number;
  ballistic: number;
  missile: number;
}

export type HardpointMap = Partial<Record<MechLocation, HardpointCount>>;

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
  /** A barrel chest: bellied out low and drawn in under a heavy collar. */
  barrel: [
    [-0.46, -0.34],
    [0.2, -0.5],
    [0.5, -0.24],
    [0.46, 0.22],
    [0.24, 0.5],
    [-0.34, 0.48],
    [-0.5, 0.1],
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
  /** A launcher pod: square face forward, tapered away behind the tubes. */
  pod: [
    [-0.36, -0.5],
    [0.5, -0.44],
    [0.5, 0.44],
    [-0.36, 0.5],
    [-0.5, 0],
  ],
  /** A prow: comes to a point forward, for a nose that leads the machine. */
  wedge: [
    [-0.5, -0.5],
    [0.24, -0.42],
    [0.5, 0],
    [0.24, 0.42],
    [-0.5, 0.5],
  ],
  /** A jaw: wide where it hangs, drawn in to a chin. */
  jaw: [
    [-0.44, 0.5],
    [0.5, 0.5],
    [0.34, -0.34],
    [-0.2, -0.5],
  ],
  /** A splayed foot: toe forward and low, heel short and high. */
  foot: [
    [-0.5, 0.5],
    [0.24, 0.5],
    [0.5, -0.12],
    [0.34, -0.5],
    [-0.42, -0.5],
  ],
} as const satisfies Record<string, Profile>;

export interface Blueprint {
  parts: BlueprintPart[];
  /** Where a weapon carried in each location is bolted. */
  hardpoints: Partial<Record<MechLocation, [number, number, number]>>;
  /** Height of the torso pivot, and the whole machine, in radius units. */
  torsoY: number;
  height: number;
  /**
   * Where the legs articulate, so the renderer can hang them from real pivots
   * and swing them as the mech walks rather than sliding a statue.
   */
  legs: {
    hipHeight: number;
    kneeHeight: number;
    /** How far forward of the hip the knee sits — the joint the shin hangs from. */
    kneeForward: number;
  };
  /**
   * Whether the leg locations are limbs that swing. Tracks and concrete are
   * filed under the legs because that is what they structurally are, but
   * nothing about them articulates and a walk cycle would be a catastrophe.
   */
  articulated: boolean;
}

function part(
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

/** Marks a piece as hull, so the guns traverse without taking it round too. */
function bolted(piece: BlueprintPart): BlueprintPart {
  return { ...piece, fixed: true };
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

/** Proportions every plan works from. Each plan sets its own and builds itself. */
interface Bones {
  /** Ground to the hip pivot, and half the distance between the hips. */
  hip: number;
  spread: number;
  /** Knee height, and how far forward of the hip the knee is thrown. */
  kneeHeight: number;
  knee: number;
  /** Limb thickness, which is what makes a leg look able to carry the hull. */
  thigh: number;
  /** Torso length, width, height, and how far the hull leans forward. */
  long: number;
  wide: number;
  tall: number;
  pitch: number;
  /** Half the distance between the shoulder mounts. */
  shoulder: number;
}

/** What a location is built to carry, which decides the shape bolted there. */
type Fitting = 'cannon' | 'launcher' | 'emitter' | 'bare';

function fittingFor(counts: HardpointCount | undefined): Fitting {
  if (counts === undefined) return 'bare';
  if (counts.ballistic > 0) return 'cannon';
  if (counts.missile > 0) return 'launcher';
  if (counts.energy > 0) return 'emitter';
  return 'bare';
}

// ---------------------------------------------------------------------- legs

/**
 * A leg that stands under the hull: thigh, knee, shin, boot. The knee sits
 * under the hip, so the machine carries its weight straight down and reads as
 * something that walks rather than something that springs.
 */
function walkerLeg(parts: BlueprintPart[], b: Bones, side: number, boot: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const t = b.thigh;

  parts.push(
    part(location, 'limb', [0, (b.hip + b.kneeHeight) / 2, z], [t * 1.18, b.hip - b.kneeHeight, t * 0.86], 'deep'),
    // The knee is what tells the eye which way the leg bends, and it is painted
    // like the plate around it: a bright joint reads as a bearing left exposed.
    part(location, 'sphere', [0, b.kneeHeight, z], [t * 1.06, t * 1.06, t * 1.06], 'plate'),
    part(location, 'limb', [0, b.kneeHeight * 0.5, z], [t * 0.92, b.kneeHeight * 0.86, t * 1.02], 'plate'),
    // Ankle, then a boot that is deep enough to be a foot rather than a board.
    part(location, 'sphere', [0, b.kneeHeight * 0.14, z], [t * 0.72, t * 0.72, t * 0.72], 'deep'),
    shaped(location, PROFILES.foot, [boot * 0.24, 0.1, z], [boot, 0.2, t * 1.24], 'deep'),
  );
}

/**
 * A reversed leg: the knee is thrown forward and high, the shin rakes back to
 * a low ankle, and the machine stands on a splayed toe. This is the leg that
 * says fast before anything else about the mech is read.
 */
function birdLeg(parts: BlueprintPart[], b: Bones, side: number, boot: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const t = b.thigh;
  const drop = b.hip - b.kneeHeight;
  // Lean each segment along the line between its own joints. A limb tilted
  // like this reads as a driven linkage; two vertical posts with a ball
  // between them reads as scaffolding whatever the knee is doing.
  const thighTilt = Math.atan2(b.knee, Math.max(0.01, drop));

  parts.push(
    part(location, 'limb', [b.knee * 0.5, (b.hip + b.kneeHeight) / 2, z],
      [t * 1.16, Math.hypot(drop, b.knee), t * 0.84], 'deep', thighTilt),
    part(location, 'sphere', [b.knee, b.kneeHeight, z], [t * 1.1, t * 1.1, t * 1.1], 'plate'),
    part(location, 'limb', [b.knee * 0.45, b.kneeHeight * 0.5, z],
      [t * 0.86, Math.hypot(b.kneeHeight, b.knee), t * 0.98], 'plate',
      -Math.atan2(b.knee, Math.max(0.01, b.kneeHeight))),
    part(location, 'sphere', [0, b.kneeHeight * 0.12, z], [t * 0.62, t * 0.62, t * 0.62], 'deep'),
    // A digitigrade frame stands on a long splayed pad, toes forward.
    shaped(location, PROFILES.foot, [boot * 0.3, 0.09, z], [boot, 0.18, t * 1.1], 'deep'),
  );
}

/** Hip block and the skirt plates that hang over it. */
function hips(parts: BlueprintPart[], b: Bones, skirt = 1): void {
  parts.push(part(null, 'box', [0, b.hip, 0], [b.long * 0.52, 0.26, b.spread * 2.05], 'deep'));
  for (const side of [-1, 1]) {
    parts.push(shaped(null, PROFILES.skirt,
      [b.long * 0.04, b.hip - 0.05, side * b.spread * 0.95],
      [b.long * 0.5 * skirt, 0.44 * skirt, b.thigh * 0.55], 'plate'));
  }
}

// -------------------------------------------------------------------- pieces

/** Radiator banks down the spine, so an oversized cooling plant is visible. */
function radiators(parts: BlueprintPart[], b: Bones): void {
  for (const offset of [-0.3, 0, 0.3]) {
    parts.push(part('centre_torso', 'box',
      [-b.long * 0.42, b.tall * 0.5, offset * b.wide],
      [b.long * 0.32, b.tall * 0.3, 0.1], 'accent'));
  }
}

/**
 * Masts and aerials, kept short: they are a marking, not a second machine.
 * `y` is where the mast is stepped — the top of whatever it stands on — so an
 * array never floats above the hull with daylight under it.
 */
function aerials(parts: BlueprintPart[], has: (trait: string) => boolean, x: number, y: number): void {
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

/**
 * A shoulder assembly built for what the chassis actually carries there: a
 * launcher gets a square cell box, a cannon gets a housing and an ammo drum,
 * an energy mount gets a slim finned emitter housing. Two chassis with the
 * same plan and different hardpoints come out visibly different machines.
 */
function shoulderMount(
  parts: BlueprintPart[],
  b: Bones,
  side: number,
  fitting: Fitting,
  scale: number,
  /** How far outboard and how high the mount rides, as fractions of the hull. */
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
      // The cell face, recessed and dark, so it reads as tubes not as a crate.
      part(location, 'box', [b.long * 0.34 * scale + b.long * 0.06, y, z],
        [0.06, b.tall * 0.4 * scale, b.wide * 0.32 * scale], 'deep', b.pitch),
    );
    return;
  }
  if (fitting === 'cannon') {
    parts.push(
      shaped(location, PROFILES.block, [0, y, z],
        [b.long * 0.56 * scale, b.tall * 0.48 * scale, b.wide * 0.34 * scale], 'plate', b.pitch),
      // An ammo drum on the flank: a ballistic mount has to feed from somewhere.
      part(location, 'cylinder', [-b.long * 0.26, y, z], [b.tall * 0.4 * scale, b.wide * 0.3 * scale, b.tall * 0.4 * scale], 'deep', Math.PI / 2),
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

/**
 * A hanging arm: shoulder ball, upper arm, elbow, and a forearm built for
 * whatever the arm mounts — a squared cannon shroud, a cell block, or a slim
 * emitter housing with a lens at the end.
 */
function hangingArm(
  parts: BlueprintPart[],
  b: Bones,
  side: number,
  fitting: Fitting,
  length: number,
  girth: number,
  /** How far the shoulder armour overhangs. A siege hull wears slabs. */
  pauldron = 1,
): void {
  const location = side < 0 ? 'left_arm' : 'right_arm';
  const z = side * b.shoulder;
  const top = b.tall * 0.28;

  parts.push(
    // Pauldron over the joint, overhanging it the way armour does.
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
      // A squared shroud around a barrel the model bolts on separately.
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
    // The emitter block, and a lens that catches the light at the muzzle end.
    part(location, 'box', [b.long * 0.04, wristY - length * 0.2, z], [girth * 1.3, girth * 0.9, girth * 1.3], 'deep'),
    part(location, 'box', [b.long * 0.12, wristY - length * 0.2, z], [0.06, girth * 0.5, girth * 0.7], 'glass'),
  );
}

// --------------------------------------------------------------- body plans

type Plan = (b: Bones, has: (trait: string) => boolean, fit: HardpointMap) => {
  parts: BlueprintPart[];
  hardpoints: Blueprint['hardpoints'];
  /** Top of the machine, measured from the torso pivot. */
  crown: number;
};

/**
 * The siege hull: a hundred tonnes hunched over its own feet. Everything about
 * it is front armour — a barrel chest under a heavy collar, pauldrons that
 * stand higher than the head, and a face, because the one thing a machine this
 * size is for is being seen coming.
 */
const siegePlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.68);
  hips(parts, b, 1.2);

  // Chest: bellied, collared, and leaning into the walk, over a waist drawn in
  // narrow. The taper is what makes the shoulders read as enormous.
  parts.push(
    shaped('centre_torso', PROFILES.barrel, [0, b.tall * 0.08, 0], [b.long, b.tall * 0.94, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.02, -b.tall * 0.46, 0],
      [b.long * 0.66, b.tall * 0.26, b.wide * 0.62], 'deep'),
    // The collar the head sits down inside, which is what makes it hunch.
    part('centre_torso', 'box', [-b.long * 0.14, b.tall * 0.56, 0], [b.long * 0.6, b.tall * 0.2, b.wide * 0.78], 'deep'),
  );
  for (const side of [-1, 1]) {
    parts.push(shaped(side < 0 ? 'left_torso' : 'right_torso', PROFILES.block,
      [-b.long * 0.06, 0, side * b.wide * 0.58],
      [b.long * 0.86, b.tall * 0.82, b.wide * 0.3], 'deep', b.pitch));
    // Set out and down, so the ordnance rides on the shoulder rather than
    // sitting where the face has to be.
    shoulderMount(parts, b, side, fittingFor(fit[side < 0 ? 'left_torso' : 'right_torso']), 1, 1.16, 0.72);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.48, 0, 0],
      [0.26, b.tall * 1.02, b.wide * 1.02], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  // The face: a skull carried forward of the collar, big enough to be the
  // thing you recognise at a thousand metres. A brow that overhangs, two lit
  // slits under it, and a jaw slung below with the vents cut into it.
  const headX = b.long * 0.36;
  const headY = b.tall * 0.72;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.62, 0.5, 0.66], 'deep'),
    part('head', 'box', [headX + 0.14, headY + 0.3, 0], [0.6, 0.16, 0.76], 'plate'),
    shaped('head', PROFILES.jaw, [headX + 0.06, headY - 0.34, 0], [0.56, 0.3, 0.56], 'plate'),
    part('head', 'box', [headX + 0.24, headY - 0.36, 0], [0.14, 0.14, 0.36], 'accent'),
    // Cheek plates, which is what turns a box with two lights into a face.
    part('head', 'box', [headX - 0.04, headY - 0.04, 0], [0.42, 0.3, 0.78], 'plate'),
  );
  for (const side of [-1, 1]) {
    parts.push(part('head', 'box', [headX + 0.3, headY + 0.06, side * 0.19], [0.1, 0.14, 0.2], 'glass'));
  }
  aerials(parts, has, headX - 0.3, headY + 0.24);

  // Arms: long, heavy, hanging past the hip line, under slabs of shoulder.
  for (const side of [-1, 1]) {
    hangingArm(parts, b, side, fittingFor(fit[side < 0 ? 'left_arm' : 'right_arm']), b.tall * 1.5, 0.3, 1.3);
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.16, -b.tall * 0.98, -b.shoulder],
      right_arm: [b.long * 0.16, -b.tall * 0.98, b.shoulder],
      left_torso: [b.long * 0.4, b.tall * 0.42, -b.wide * 0.78],
      right_torso: [b.long * 0.4, b.tall * 0.42, b.wide * 0.78],
      centre_torso: [b.long * 0.46, b.tall * 0.16, 0],
      head: [headX + 0.1, headY + 0.42, 0],
    },
    crown: b.tall * 1.0,
  };
};

/**
 * The pod carrier: a wide flat hull slung forward over reversed legs, with the
 * cockpit in the nose where a cockpit has no business being and the whole
 * payload in two square pods riding high on the shoulders. Fast, and it looks
 * fast standing still.
 */
const battlePlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) birdLeg(parts, b, side, 0.66);
  hips(parts, b, 0.9);

  parts.push(
    // A long low hull, wide and pitched down at the nose.
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall, b.wide * 1.1], 'plate', b.pitch),
    // Spine spar running back from the collar, which is what the pods bolt to.
    part('centre_torso', 'box', [-b.long * 0.22, b.tall * 0.52, 0], [b.long * 0.6, b.tall * 0.3, b.wide * 0.66], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    // The pods are the machine. Square, taller than the hull they ride on,
    // set wide enough to clear the shoulders and canted a few degrees down at
    // the muzzle face. Everything else on this plan is a way of carrying them.
    parts.push(
      shaped(location, PROFILES.pod, [-b.long * 0.06, b.tall * 1.0, side * b.wide * 1.0],
        [b.long * 0.66, b.tall * 1.15, b.wide * 0.62], 'plate', b.pitch + 0.1),
      // The cell face, recessed and dark.
      part(location, 'box', [b.long * 0.28, b.tall * 1.0, side * b.wide * 1.0],
        [0.08, b.tall * 0.9, b.wide * 0.46], 'deep', b.pitch + 0.1),
      // A cap along the top of the pod, so it has an edge the light catches.
      part(location, 'box', [-b.long * 0.08, b.tall * 1.6, side * b.wide * 1.0],
        [b.long * 0.5, 0.1, b.wide * 0.5], 'deep', b.pitch + 0.1),
      // The strut that carries the pod out from the spine.
      part(location, 'box', [-b.long * 0.14, b.tall * 0.6, side * b.wide * 0.66],
        [b.long * 0.3, b.tall * 0.7, b.wide * 0.3], 'deep'),
    );
  }
  if (has('oversized_sinks')) radiators(parts, b);

  // The cockpit is in the prow: a raked canopy set into the nose of the hull,
  // under the pods rather than above them.
  const headX = b.long * 0.42;
  const headY = b.tall * 0.16;
  parts.push(
    shaped('head', PROFILES.wedge, [headX, headY, 0], [b.long * 0.34, b.tall * 0.42, b.wide * 0.5], 'deep', b.pitch),
    part('head', 'box', [headX + 0.1, headY + 0.04, 0], [0.14, b.tall * 0.2, b.wide * 0.34], 'glass', b.pitch),
    part('head', 'box', [headX - 0.04, headY + b.tall * 0.26, 0], [b.long * 0.2, 0.08, b.wide * 0.42], 'plate', b.pitch),
  );
  aerials(parts, has, headX - b.long * 0.3, headY + b.tall * 0.4);

  // Arm pods hang outboard and below the shoulder pods — short, fat, and all
  // muzzle. No hands: nothing on this machine is meant to pick anything up.
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    const z = side * b.shoulder;
    const fitting = fittingFor(fit[location]);
    parts.push(
      part(location, 'sphere', [-b.long * 0.02, b.tall * 0.2, z * 0.86], [0.3, 0.3, 0.3], 'deep'),
      shaped(location, PROFILES.block, [b.long * 0.04, -b.tall * 0.06, z],
        [b.long * 0.54, b.tall * 0.44, b.wide * 0.3], 'plate', b.pitch),
    );
    if (fitting === 'emitter') {
      for (const level of [-0.1, 0.1]) {
        parts.push(part(location, 'box', [b.long * 0.3, -b.tall * 0.06 + level, z], [0.08, 0.1, 0.1], 'glass'));
      }
    } else {
      parts.push(part(location, 'box', [b.long * 0.28, -b.tall * 0.06, z], [0.1, b.tall * 0.24, b.wide * 0.2], 'deep'));
    }
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.36, -b.tall * 0.06, -b.shoulder],
      right_arm: [b.long * 0.36, -b.tall * 0.06, b.shoulder],
      left_torso: [b.long * 0.3, b.tall * 1.0, -b.wide],
      right_torso: [b.long * 0.3, b.tall * 1.0, b.wide],
      centre_torso: [b.long * 0.44, b.tall * 0.4, 0],
      head: [headX, headY + b.tall * 0.34, 0],
    },
    crown: b.tall * 1.7,
  };
};

/**
 * The soldier: upright, even, arms at its sides, head on its shoulders. The
 * shape every other plan is read against, and the one that has to look
 * competent rather than characterful.
 */
const humanoidPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.5);
  hips(parts, b);

  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    // Panel breaks across the chest. Two thin strips proud of the plate is
    // most of what separates a machine somebody built from an extrusion.
    part('centre_torso', 'box', [b.long * 0.3, b.tall * 0.28, 0], [b.long * 0.32, b.tall * 0.1, b.wide * 0.84], 'deep', b.pitch),
    part('centre_torso', 'box', [b.long * 0.3, -b.tall * 0.22, 0], [b.long * 0.32, b.tall * 0.1, b.wide * 0.84], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    parts.push(shaped(side < 0 ? 'left_torso' : 'right_torso', PROFILES.block,
      [-b.long * 0.08, b.tall * 0.04, side * b.wide * 0.56],
      [b.long * 0.8, b.tall * 0.76, b.wide * 0.3], 'deep', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[side < 0 ? 'left_torso' : 'right_torso']), 0.82);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.5, b.tall * 0.04, 0],
      [0.22, b.tall * 1.02, b.wide], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.26;
  const headY = b.tall * 0.66;
  parts.push(
    part('head', 'cylinder', [headX - 0.06, headY - 0.2, 0], [0.2, 0.2, 0.2], 'deep'),
    shaped('head', PROFILES.canopy, [headX, headY, 0], [0.46, 0.36, 0.44], 'deep'),
    part('head', 'box', [headX + 0.16, headY + 0.02, 0], [0.12, 0.16, 0.3], 'glass'),
    part('head', 'box', [headX + 0.02, headY + 0.19, 0], [0.34, 0.08, 0.4], 'plate'),
  );
  aerials(parts, has, headX, headY + 0.16);

  for (const side of [-1, 1]) {
    hangingArm(parts, b, side, fittingFor(fit[side < 0 ? 'left_arm' : 'right_arm']), b.tall * 1.25, 0.24);
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.14, -b.tall * 0.78, -b.shoulder],
      right_arm: [b.long * 0.14, -b.tall * 0.78, b.shoulder],
      left_torso: [b.long * 0.34, b.tall * 0.42, -b.wide * 0.78],
      right_torso: [b.long * 0.34, b.tall * 0.42, b.wide * 0.78],
      centre_torso: [b.long * 0.44, b.tall * 0.3, 0],
      head: [headX, headY + 0.26, 0],
    },
    crown: b.tall * 0.9,
  };
};

/**
 * The brawler: a heavy that fights close. Shoulders carried high and forward,
 * the cockpit sunk into the chest behind an armoured visor band rather than
 * perched on top where a large laser can find it, and short arms that end in
 * working hardware.
 */
const brawlerPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.56);
  hips(parts, b, 1.05);

  parts.push(
    shaped('centre_torso', PROFILES.barrel, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    // A yoke across the top of the chest that the shoulders hang from.
    part('centre_torso', 'box', [-b.long * 0.1, b.tall * 0.5, 0], [b.long * 0.56, b.tall * 0.22, b.wide * 1.16], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    parts.push(shaped(side < 0 ? 'left_torso' : 'right_torso', PROFILES.pauldron,
      [b.long * 0.04, b.tall * 0.28, side * b.wide * 0.68],
      [b.long * 0.72, b.tall * 0.58, b.wide * 0.36], 'plate', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[side < 0 ? 'left_torso' : 'right_torso']), 0.72);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.48, 0, 0],
      [0.24, b.tall * 0.96, b.wide * 0.98], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  // The head is a band in the chest, not a turret on a neck.
  const headX = b.long * 0.4;
  const headY = b.tall * 0.24;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.2, b.tall * 0.3, b.wide * 0.54], 'deep', b.pitch),
    part('head', 'box', [headX + 0.1, headY, 0], [0.08, b.tall * 0.14, b.wide * 0.44], 'glass', b.pitch),
    part('head', 'box', [headX + 0.02, headY + b.tall * 0.2, 0], [0.24, 0.09, b.wide * 0.6], 'plate', b.pitch),
  );
  aerials(parts, has, headX - b.long * 0.4, headY + b.tall * 0.38);

  for (const side of [-1, 1]) {
    hangingArm(parts, b, side, fittingFor(fit[side < 0 ? 'left_arm' : 'right_arm']), b.tall * 1.05, 0.27);
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.16, -b.tall * 0.62, -b.shoulder],
      right_arm: [b.long * 0.16, -b.tall * 0.62, b.shoulder],
      left_torso: [b.long * 0.32, b.tall * 0.42, -b.wide * 0.78],
      right_torso: [b.long * 0.32, b.tall * 0.42, b.wide * 0.78],
      centre_torso: [b.long * 0.46, b.tall * 0.02, 0],
      head: [headX, headY + b.tall * 0.34, 0],
    },
    crown: b.tall * 0.86,
  };
};

/**
 * The walking bunker: a wide low hull carried on splayed legs, with the guns
 * in a dorsal turret and sponsons on the hull flanks. No arms — there is
 * nothing on it that is not armour or ordnance.
 */
const bastionPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.72);
  hips(parts, b, 1.3);

  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall * 0.9, b.wide], 'plate', b.pitch),
    // A glacis across the front, which is the whole design brief of the hull.
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.46, -b.tall * 0.06, 0],
      [b.long * 0.3, b.tall * 0.66, b.wide * 0.94], 'trim', b.pitch),
  );
  for (const side of [-1, 1]) {
    // Sponsons: the flanks are structure, not shoulders.
    parts.push(shaped(side < 0 ? 'left_torso' : 'right_torso', PROFILES.block,
      [-b.long * 0.04, -b.tall * 0.04, side * b.wide * 0.62],
      [b.long * 0.9, b.tall * 0.6, b.wide * 0.34], 'deep', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[side < 0 ? 'left_torso' : 'right_torso']), 0.9);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.52, 0, 0],
      [0.28, b.tall * 0.92, b.wide * 1.04], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  // The turret carries what the arms would have: a squat ring, a mantlet, and
  // the barrels the model bolts to the arm hardpoints. It belongs to the
  // torso, so it tracks with the twist the way a turret should.
  const turretY = b.tall * 0.62;
  parts.push(
    part('centre_torso', 'cylinder', [-b.long * 0.04, turretY - 0.12, 0], [b.wide * 0.68, 0.2, b.wide * 0.68], 'deep'),
    shaped('centre_torso', PROFILES.block, [0, turretY + 0.1, 0], [b.long * 0.6, b.tall * 0.4, b.wide * 0.62], 'plate'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    parts.push(part(location, 'box', [b.long * 0.24, turretY + 0.08, side * b.wide * 0.22],
      [b.long * 0.34, 0.22, 0.22], 'deep'));
  }

  // A cupola rather than a cockpit: the crew sit down inside the hull.
  const headX = b.long * 0.24;
  const headY = turretY + 0.3;
  parts.push(
    part('head', 'cylinder', [headX, headY, 0], [0.34, 0.2, 0.34], 'deep'),
    part('head', 'box', [headX + 0.14, headY + 0.02, 0], [0.08, 0.1, 0.24], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.1);

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.44, turretY + 0.08, -b.wide * 0.22],
      right_arm: [b.long * 0.44, turretY + 0.08, b.wide * 0.22],
      left_torso: [b.long * 0.34, b.tall * 0.42, -b.wide * 0.78],
      right_torso: [b.long * 0.34, b.tall * 0.42, b.wide * 0.78],
      centre_torso: [b.long * 0.5, -b.tall * 0.24, 0],
      head: [headX, headY + 0.18, 0],
    },
    crown: turretY + 0.5,
  };
};

/**
 * The harasser: a small hull thrown forward over long reversed legs, with a
 * beaked cockpit out in front and its weapons in nacelles either side. Built
 * around the stride; nothing on it is meant to trade fire standing still.
 */
const birdPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) birdLeg(parts, b, side, 0.6);
  hips(parts, b, 0.85);

  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.34, b.tall * 0.4, 0], [b.long * 0.34, b.tall * 0.3, b.wide * 0.6], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    // Nacelles: slim, faired, carried out on the flank rather than stacked up.
    parts.push(
      shaped(location, PROFILES.pod, [-b.long * 0.02, b.tall * 0.18, side * b.wide * 0.84],
        [b.long * 0.66, b.tall * 0.5, b.wide * 0.36], 'plate', b.pitch),
      part(location, 'box', [b.long * 0.28, b.tall * 0.18, side * b.wide * 0.84],
        [0.07, b.tall * 0.3, b.wide * 0.24], 'deep', b.pitch),
    );
    if (fittingFor(fit[location]) === 'cannon') {
      parts.push(part(location, 'cylinder', [-b.long * 0.22, b.tall * 0.18, side * b.wide * 0.84],
        [b.tall * 0.34, b.wide * 0.26, b.tall * 0.34], 'deep', Math.PI / 2));
    }
  }
  if (has('oversized_sinks')) radiators(parts, b);

  // A beak: the cockpit rides out ahead of the hull on a short neck.
  const headX = b.long * 0.56;
  const headY = b.tall * 0.34;
  parts.push(
    part('head', 'cylinder', [headX - 0.16, headY - 0.06, 0], [0.16, 0.22, 0.16], 'deep'),
    shaped('head', PROFILES.wedge, [headX, headY, 0], [0.5, 0.32, 0.4], 'deep', b.pitch),
    part('head', 'box', [headX + 0.06, headY + 0.03, 0], [0.16, 0.14, 0.26], 'glass', b.pitch),
    part('head', 'box', [headX - 0.06, headY + 0.18, 0], [0.3, 0.07, 0.34], 'plate', b.pitch),
  );
  aerials(parts, has, headX - 0.2, headY + 0.14);

  // Stub arms: fairings with a muzzle, tucked under the nacelles.
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    parts.push(
      part(location, 'sphere', [0, b.tall * 0.02, side * b.shoulder * 0.9], [0.24, 0.24, 0.24], 'deep'),
      part(location, 'limb', [b.long * 0.12, -b.tall * 0.16, side * b.shoulder], [0.24, b.tall * 0.5, 0.2], 'plate'),
    );
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.24, -b.tall * 0.34, -b.shoulder],
      right_arm: [b.long * 0.24, -b.tall * 0.34, b.shoulder],
      left_torso: [b.long * 0.3, b.tall * 0.18, -b.wide * 0.84],
      right_torso: [b.long * 0.3, b.tall * 0.18, b.wide * 0.84],
      centre_torso: [b.long * 0.36, b.tall * 0.46, 0],
      head: [headX - 0.1, headY + 0.3, 0],
    },
    crown: b.tall * 0.8,
  };
};

/**
 * The scout: as little machine as can be wrapped around a sensor mast and a
 * pair of legs. Spindly on purpose — the reason to build one is that it is
 * somewhere else before anyone finishes counting it.
 */
const scoutPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) birdLeg(parts, b, side, 0.46);
  hips(parts, b, 0.7);

  parts.push(
    shaped('centre_torso', PROFILES.wedge, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.3, b.tall * 0.34, 0], [b.long * 0.3, b.tall * 0.34, b.wide * 0.5], 'deep'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    if (fittingFor(fit[location]) === 'bare') continue;
    parts.push(shaped(location, PROFILES.pod, [-b.long * 0.04, b.tall * 0.3, side * b.wide * 0.7],
      [b.long * 0.44, b.tall * 0.42, b.wide * 0.3], 'plate', b.pitch));
  }

  // Canopy set right on the nose: on a mech this size the cockpit is most of
  // the hull, and the mast above it is the point of the whole machine.
  const headX = b.long * 0.34;
  const headY = b.tall * 0.4;
  parts.push(
    shaped('head', PROFILES.canopy, [headX, headY, 0], [0.42, 0.32, 0.38], 'deep', b.pitch),
    part('head', 'box', [headX + 0.14, headY + 0.02, 0], [0.12, 0.15, 0.26], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.14);

  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    parts.push(part(location, 'limb', [b.long * 0.1, -b.tall * 0.1, side * b.shoulder], [0.2, b.tall * 0.62, 0.17], 'deep'));
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.18, -b.tall * 0.4, -b.shoulder],
      right_arm: [b.long * 0.18, -b.tall * 0.4, b.shoulder],
      left_torso: [b.long * 0.2, b.tall * 0.3, -b.wide * 0.7],
      right_torso: [b.long * 0.2, b.tall * 0.3, b.wide * 0.7],
      centre_torso: [b.long * 0.3, b.tall * 0.4, 0],
      head: [headX, headY + 0.26, 0],
    },
    crown: b.tall * 0.7,
  };
};

/**
 * The line-holder: wide, low and planted, with a shield plate on one shoulder
 * and everything else built to be shot at. It is the shape of a machine that
 * has been told where to stand.
 */
const squatPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.62);
  hips(parts, b, 1.25);

  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [b.long * 0.26, 0, 0], [b.long * 0.3, b.tall * 0.7, b.wide * 0.5], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    parts.push(shaped(side < 0 ? 'left_torso' : 'right_torso', PROFILES.block,
      [-b.long * 0.06, 0, side * b.wide * 0.6],
      [b.long * 0.84, b.tall * 0.74, b.wide * 0.32], 'deep', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[side < 0 ? 'left_torso' : 'right_torso']), 0.86);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.5, 0, 0],
      [0.26, b.tall, b.wide], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.22;
  const headY = b.tall * 0.6;
  parts.push(
    shaped('head', PROFILES.canopy, [headX, headY, 0], [0.44, 0.34, 0.46], 'deep'),
    part('head', 'box', [headX + 0.15, headY + 0.02, 0], [0.12, 0.15, 0.3], 'glass'),
    part('head', 'box', [headX, headY + 0.18, 0], [0.36, 0.08, 0.44], 'plate'),
  );
  aerials(parts, has, headX, headY + 0.16);

  // One arm carries a shield slab; the other is a working mount. Asymmetry is
  // what stops a wide flat machine reading as a filing cabinet.
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    hangingArm(parts, b, side, fittingFor(fit[location]), b.tall * 1.1, 0.26);
  }
  parts.push(shaped('left_arm', PROFILES.pauldron, [b.long * 0.16, -b.tall * 0.24, -b.shoulder * 1.24],
    [b.long * 0.72, b.tall * 1.1, 0.16], 'trim', b.pitch));

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.16, -b.tall * 0.66, -b.shoulder],
      right_arm: [b.long * 0.16, -b.tall * 0.66, b.shoulder],
      left_torso: [b.long * 0.34, b.tall * 0.42, -b.wide * 0.78],
      right_torso: [b.long * 0.34, b.tall * 0.42, b.wide * 0.78],
      centre_torso: [b.long * 0.46, b.tall * 0.16, 0],
      head: [headX, headY + 0.24, 0],
    },
    crown: b.tall * 0.86,
  };
};

// ------------------------------------------------------------ ground frames

/**
 * A track unit: a long low box under the hull with road wheels along it and a
 * drive sprocket at each end. It is filed under the leg locations because that
 * is structurally what it is, and losing one ends the argument about whether
 * there is time to withdraw.
 */
function trackUnit(parts: BlueprintPart[], b: Bones, side: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const height = b.hip * 0.9;

  parts.push(
    shaped(location, PROFILES.skirt, [0, height * 0.66, z], [b.long * 1.2, height * 0.5, b.thigh * 1.4], 'plate'),
    part(location, 'box', [0, height * 0.34, z], [b.long * 1.24, height * 0.52, b.thigh * 1.2], 'deep'),
  );
  for (const along of [-0.38, -0.13, 0.13, 0.38]) {
    parts.push(part(location, 'cylinder', [b.long * along, height * 0.24, z],
      [height * 0.34, b.thigh * 1.3, height * 0.34], 'accent', Math.PI / 2));
  }
  // Drive sprocket and idler, one at each end, which is what makes it a track.
  for (const end of [-0.56, 0.56]) {
    parts.push(part(location, 'cylinder', [b.long * end, height * 0.4, z],
      [height * 0.44, b.thigh * 1.24, height * 0.44], 'trim', Math.PI / 2));
  }
}

/** Road wheels: what a patrol car has instead, and why it dies to one burst. */
function wheelUnit(parts: BlueprintPart[], b: Bones, side: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const radius = b.hip * 0.46;

  parts.push(part(location, 'box', [0, b.hip * 0.74, z], [b.long * 1.1, b.hip * 0.3, b.thigh], 'deep'));
  for (const along of [-0.44, 0, 0.44]) {
    parts.push(
      part(location, 'cylinder', [b.long * along, radius, z], [radius * 2, b.thigh * 1.1, radius * 2], 'deep', Math.PI / 2),
      part(location, 'cylinder', [b.long * along, radius, z * 1.05], [radius, b.thigh * 1.2, radius], 'accent', Math.PI / 2),
    );
  }
}

/**
 * The hull and turret every ground vehicle shares. Where a mech twists at the
 * waist, this traverses: the turret is the torso and the hull is bolted down,
 * which is the whole difference in silhouette between the two kinds of machine.
 */
function vehicleBody(
  parts: BlueprintPart[],
  b: Bones,
  has: (trait: string) => boolean,
  fit: HardpointMap,
): void {
  const deck = b.hip * 0.92;

  parts.push(
    bolted(shaped('centre_torso', PROFILES.hull, [0, deck + b.tall * 0.16, 0],
      [b.long * 1.5, b.tall * 0.56, b.wide * 1.5], 'plate')),
    bolted(part('centre_torso', 'cylinder', [0, deck + b.tall * 0.46, 0],
      [b.wide * 0.92, b.tall * 0.12, b.wide * 0.92], 'deep')),
    // The traversing part: everything from here up turns with the guns.
    shaped('centre_torso', PROFILES.wedge, [0, deck + b.tall * 0.72, 0],
      [b.long * 0.94, b.tall * 0.46, b.wide * 0.96], 'plate'),
  );

  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block, [-b.long * 0.08, deck + b.tall * 0.7, side * b.wide * 0.54],
      [b.long * 0.72, b.tall * 0.4, b.wide * 0.24], 'deep'));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 1, 0.9, 0.4);
  }

  // The cupola stands in for a cockpit: it is where the crew are, and it is
  // what a called shot to the head is aimed at.
  const headX = -b.long * 0.18;
  const headY = deck + b.tall * 1.04;
  parts.push(
    part('head', 'cylinder', [headX, headY, b.wide * 0.26], [0.34, 0.24, 0.34], 'deep'),
    part('head', 'box', [headX + 0.16, headY + 0.02, b.wide * 0.26], [0.1, 0.12, 0.26], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.12);
}

/** Where a vehicle's guns hang, shared by both running gears. */
function vehicleHardpoints(b: Bones): Blueprint['hardpoints'] {
  const deck = b.hip * 0.92;
  return {
    left_torso: [b.long * 0.2, deck + b.tall * 0.76, -b.wide * 0.64],
    right_torso: [b.long * 0.2, deck + b.tall * 0.76, b.wide * 0.64],
    centre_torso: [b.long * 0.48, deck + b.tall * 0.72, 0],
    head: [-b.long * 0.18, deck + b.tall * 1.2, b.wide * 0.26],
    left_arm: [0, deck, -b.wide * 0.72],
    right_arm: [0, deck, b.wide * 0.72],
  };
}

/** Tracked: the missile deck. Devastating from a ridge, finished once reached. */
const trackedPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) trackUnit(parts, b, side);
  vehicleBody(parts, b, has, fit);
  if (has('oversized_sinks')) radiators(parts, b);

  return { parts, hardpoints: vehicleHardpoints(b), crown: b.tall * 1.5 };
};

/** Wheeled: the patrol car. The same hull, on tyres, with nothing to spare. */
const wheeledPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) wheelUnit(parts, b, side);
  vehicleBody(parts, b, has, fit);

  return { parts, hardpoints: vehicleHardpoints(b), crown: b.tall * 1.5 };
};

/**
 * An emplacement: a concrete pad, a ring, and a slab of a mount that traverses
 * on it. There is no running gear because there is nowhere to run to, and the
 * tonnage an engine would have taken went into the mantlet instead.
 */
const emplacementPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];

  // The pad, filed under the legs so a wreck still greys out from the ground up.
  for (const side of [-1, 1]) {
    parts.push(part(side < 0 ? 'left_leg' : 'right_leg', 'box',
      [0, b.hip * 0.16, side * b.spread * 0.9],
      [b.long * 1.6, b.hip * 0.32, b.wide * 0.86], 'deep'));
  }
  parts.push(bolted(part(null, 'cylinder', [0, b.hip * 0.46, 0],
    [b.wide * 1.5, b.hip * 0.28, b.wide * 1.5], 'trim')));

  parts.push(
    shaped('centre_torso', PROFILES.wedge, [0, b.tall * 0.08, 0], [b.long * 1.2, b.tall * 0.9, b.wide * 1.2], 'plate'),
    // The mantlet. The whole point of the machine, and the reason flanking one
    // is the only sensible answer to it.
    shaped('centre_torso', PROFILES.pauldron, [b.long * 0.56, 0, 0], [0.34, b.tall * 1.06, b.wide * 1.1], 'trim'),
  );

  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block, [-b.long * 0.1, b.tall * 0.06, side * b.wide * 0.68],
      [b.long * 0.9, b.tall * 0.74, b.wide * 0.34], 'deep'));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 1, 1, 0.2);
  }

  const headX = -b.long * 0.3;
  const headY = b.tall * 0.6;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.4, 0.28, 0.5], 'deep'),
    part('head', 'box', [headX + 0.2, headY, 0], [0.1, 0.14, 0.34], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.14);

  return {
    parts,
    hardpoints: {
      left_torso: [b.long * 0.3, b.tall * 0.1, -b.wide * 0.8],
      right_torso: [b.long * 0.3, b.tall * 0.1, b.wide * 0.8],
      centre_torso: [b.long * 0.62, b.tall * 0.02, 0],
      head: [headX, headY + 0.2, 0],
      left_arm: [0, 0, -b.wide * 0.92],
      right_arm: [0, 0, b.wide * 0.92],
    },
    crown: b.tall * 0.9,
  };
};

/** Base proportions per plan, before a chassis scales them to its own build. */
const BASE: Record<Silhouette['form'], Bones> = {
  scout: { hip: 1.2, spread: 0.3, kneeHeight: 0.66, knee: 0.3, thigh: 0.19, long: 0.8, wide: 0.56, tall: 0.5, pitch: 0.2, shoulder: 0.4 },
  bird: { hip: 1.24, spread: 0.36, kneeHeight: 0.7, knee: 0.34, thigh: 0.24, long: 1.0, wide: 0.7, tall: 0.6, pitch: 0.24, shoulder: 0.56 },
  humanoid: { hip: 1.0, spread: 0.4, kneeHeight: 0.48, knee: 0, thigh: 0.28, long: 0.94, wide: 0.84, tall: 0.84, pitch: 0.04, shoulder: 0.7 },
  brawler: { hip: 0.94, spread: 0.46, kneeHeight: 0.44, knee: 0, thigh: 0.32, long: 0.92, wide: 1.0, tall: 0.82, pitch: 0.1, shoulder: 0.78 },
  battle: { hip: 1.34, spread: 0.44, kneeHeight: 0.76, knee: 0.4, thigh: 0.3, long: 1.14, wide: 0.9, tall: 0.62, pitch: 0.18, shoulder: 0.86 },
  squat: { hip: 0.92, spread: 0.56, kneeHeight: 0.42, knee: 0, thigh: 0.34, long: 1.0, wide: 1.14, tall: 0.72, pitch: 0.02, shoulder: 0.88 },
  bastion: { hip: 0.88, spread: 0.62, kneeHeight: 0.4, knee: -0.04, thigh: 0.38, long: 1.16, wide: 1.24, tall: 0.7, pitch: 0, shoulder: 0.96 },
  siege: { hip: 0.98, spread: 0.58, kneeHeight: 0.46, knee: 0, thigh: 0.4, long: 1.08, wide: 1.2, tall: 0.94, pitch: 0.08, shoulder: 1.02 },
  // Ground frames sit low and wide. `hip` is the height of the running gear
  // rather than of a joint, and `spread` is how far out the tracks are set.
  tracked: { hip: 0.42, spread: 0.62, kneeHeight: 0.2, knee: 0, thigh: 0.3, long: 1.06, wide: 0.92, tall: 0.6, pitch: 0, shoulder: 0.8 },
  wheeled: { hip: 0.38, spread: 0.56, kneeHeight: 0.18, knee: 0, thigh: 0.24, long: 0.98, wide: 0.78, tall: 0.5, pitch: 0, shoulder: 0.7 },
  emplacement: { hip: 0.3, spread: 0.7, kneeHeight: 0.14, knee: 0, thigh: 0.34, long: 1.1, wide: 1.16, tall: 0.86, pitch: 0, shoulder: 0.94 },
};

const PLANS: Record<Silhouette['form'], Plan> = {
  scout: scoutPlan,
  bird: birdPlan,
  humanoid: humanoidPlan,
  brawler: brawlerPlan,
  battle: battlePlan,
  squat: squatPlan,
  bastion: bastionPlan,
  siege: siegePlan,
  tracked: trackedPlan,
  wheeled: wheeledPlan,
  emplacement: emplacementPlan,
};

/** Which plans build something with legs that swing. */
const WALKS: ReadonlySet<Silhouette['form']> = new Set([
  'scout',
  'bird',
  'humanoid',
  'brawler',
  'battle',
  'squat',
  'bastion',
  'siege',
]);

/**
 * Builds a chassis from its body plan, then lets its traits mark it: a sensor
 * mast, a command array, a hardened mantlet and oversized sinks are all things
 * the lore says about a machine, and all things you should be able to see.
 *
 * The hardpoint map is part of the shape, not decoration on top of it. A
 * shoulder that feeds a launcher is built as a cell box; one that feeds a
 * cannon gets a housing and an ammo drum. Two chassis on the same plan with
 * different armament come out as different machines.
 */
export function chassisBlueprint(
  shape: Silhouette,
  traits: readonly string[],
  fit: HardpointMap = {},
): Blueprint {
  const base = BASE[shape.form];
  const has = (trait: string): boolean => traits.includes(trait);

  const bones: Bones = {
    ...base,
    hip: base.hip * shape.legLength * (has('long_stride') ? 1.1 : 1),
    kneeHeight: base.kneeHeight * shape.legLength * (has('long_stride') ? 1.1 : 1),
    knee: base.knee * shape.legLength,
    spread: base.spread * shape.stance * (has('wide_stance') ? 1.22 : 1),
    thigh: base.thigh * (has('reinforced_legs') ? 1.22 : 1) * Math.min(1.25, 0.6 + shape.torsoWidth * 0.5),
    long: base.long * shape.torsoLength,
    wide: base.wide * shape.torsoWidth * (has('narrow_profile') ? 0.84 : 1),
    shoulder: base.shoulder * shape.shoulder,
  };

  const built = PLANS[shape.form](bones, has, fit);
  const torsoY = bones.hip + bones.tall * 0.5;

  return {
    parts: built.parts,
    hardpoints: built.hardpoints,
    torsoY,
    height: torsoY + built.crown,
    legs: {
      hipHeight: bones.hip,
      kneeHeight: bones.kneeHeight,
      kneeForward: bones.knee,
    },
    articulated: WALKS.has(shape.form),
  };
}
