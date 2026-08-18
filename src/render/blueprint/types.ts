import type { MechLocation } from '../../schema/common';

export type Tone = 'plate' | 'deep' | 'trim' | 'glass' | 'accent';

/** Tapered segments carry weight more convincingly than straight prisms. */
export type PartShape = 'box' | 'cylinder' | 'sphere' | 'limb';

/** A convex side profile in part-local coordinates, wound anticlockwise. */
export type Profile = readonly (readonly [number, number])[];

/** Unit factors keep the authored footprint stable while the outer plates lean. */
export interface TransverseTaper {
  front?: number;
  rear?: number;
  top?: number;
  bottom?: number;
  /** A small clipped rim catches light without spending triangles on a rounded bevel. */
  edge?: number;
}

export interface BlueprintPart {
  /** Damage still owns the part even when its shape is decorative. */
  location: MechLocation | null;
  shape: PartShape;
  at: [number, number, number];
  size: [number, number, number];
  tone: Tone;
  /** Lean about the lateral axis, in radians. Positive pitches the nose down. */
  tilt?: number;
  /** Vehicle hull pieces stay put while the turret traverses. */
  fixed?: boolean;
  profile?: Profile;
  transverse?: TransverseTaper;
}

export interface HardpointCount {
  energy: number;
  ballistic: number;
  missile: number;
}

export type HardpointMap = Partial<Record<MechLocation, HardpointCount>>;

export interface Blueprint {
  parts: BlueprintPart[];
  hardpoints: Partial<Record<MechLocation, [number, number, number]>>;
  torsoY: number;
  height: number;
  legs: {
    hipHeight: number;
    kneeHeight: number;
    kneeForward: number;
  };
  articulated: boolean;
}

/** Proportions every plan works from. Each plan still builds its own machine. */
export interface Bones {
  hip: number;
  spread: number;
  kneeHeight: number;
  knee: number;
  thigh: number;
  long: number;
  wide: number;
  tall: number;
  pitch: number;
  shoulder: number;
}

export type Fitting = 'cannon' | 'launcher' | 'emitter' | 'bare';

export type Plan = (
  bones: Bones,
  has: (trait: string) => boolean,
  fit: HardpointMap,
  identity: string | null,
) => {
  parts: BlueprintPart[];
  hardpoints: Blueprint['hardpoints'];
  /** Top of the machine, measured from the torso pivot. */
  crown: number;
};
