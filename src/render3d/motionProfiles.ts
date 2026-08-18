import type { Silhouette } from '../render/shape';

export const WALKING_FORMS = [
  'scout',
  'bird',
  'humanoid',
  'brawler',
  'battle',
  'squat',
  'bastion',
  'siege',
] as const;

export type WalkingForm = (typeof WALKING_FORMS)[number];

export interface MotionProfile {
  form: WalkingForm;
  /** Higher cadence spends less distance on each step. */
  cadence: number;
  kneeLift: number;
  bob: number;
  torsoCounter: number;
  lean: number;
  tuck: number;
  response: number;
}

export interface StrideTerrain {
  stride: number;
  swing: number;
}

type BaseProfile = Omit<MotionProfile, 'form'>;

const OPEN_SWING = 0.42;
export const OPEN_STRIDE_TERRAIN: Readonly<StrideTerrain> = {
  stride: 1,
  swing: OPEN_SWING,
};
const BASE_PROFILES: Record<WalkingForm, BaseProfile> = {
  scout: {
    cadence: 1.22,
    kneeLift: 0.74,
    bob: 1.08,
    torsoCounter: 0.066,
    lean: 0.062,
    tuck: 0.82,
    response: 10,
  },
  bird: {
    cadence: 1.12,
    kneeLift: 0.82,
    bob: 0.94,
    torsoCounter: 0.074,
    lean: 0.068,
    tuck: 0.92,
    response: 9,
  },
  humanoid: {
    cadence: 1,
    kneeLift: 0.58,
    bob: 0.84,
    torsoCounter: 0.048,
    lean: 0.052,
    tuck: 0.7,
    response: 8,
  },
  brawler: {
    cadence: 0.92,
    kneeLift: 0.52,
    bob: 0.65,
    torsoCounter: 0.038,
    lean: 0.058,
    tuck: 0.64,
    response: 7.2,
  },
  battle: {
    cadence: 0.95,
    kneeLift: 0.7,
    bob: 0.72,
    torsoCounter: 0.052,
    lean: 0.064,
    tuck: 0.84,
    response: 7,
  },
  squat: {
    cadence: 0.84,
    kneeLift: 0.46,
    bob: 0.48,
    torsoCounter: 0.032,
    lean: 0.046,
    tuck: 0.58,
    response: 6.2,
  },
  bastion: {
    cadence: 0.74,
    kneeLift: 0.4,
    bob: 0.35,
    torsoCounter: 0.024,
    lean: 0.04,
    tuck: 0.5,
    response: 5.4,
  },
  siege: {
    cadence: 0.68,
    kneeLift: 0.43,
    bob: 0.3,
    torsoCounter: 0.028,
    lean: 0.044,
    tuck: 0.55,
    response: 4.8,
  },
};

export function isWalkingForm(form: Silhouette['form']): form is WalkingForm {
  return (WALKING_FORMS as readonly Silhouette['form'][]).includes(form);
}

/** Weight changes the recovery, not the battlefield speed that the simulation owns. */
export function motionProfileFor(
  form: Silhouette['form'],
  tonnage: number,
): MotionProfile | null {
  if (!isWalkingForm(form)) return null;
  const base = BASE_PROFILES[form];
  const weight = clamp((tonnage - 20) / 80, 0, 1);
  return {
    form,
    cadence: base.cadence * (1 - weight * 0.08),
    kneeLift: base.kneeLift * (1 - weight * 0.12),
    bob: base.bob * (1 - weight * 0.32),
    torsoCounter: base.torsoCounter * (1 - weight * 0.18),
    lean: base.lean * (0.9 + weight * 0.28),
    tuck: base.tuck * (1 - weight * 0.1),
    response: base.response * (1 - weight * 0.24),
  };
}

/** A shorter terrain stride must also shorten the arc, or the planted foot slides. */
export function strideLengthFor(
  legReach: number,
  profile: MotionProfile,
  terrain: StrideTerrain,
): number {
  const terrainReach = terrain.stride * (terrain.swing / OPEN_SWING);
  return Math.max(0.1, (legReach * 0.72 * terrainReach) / profile.cadence);
}

export function strideSwing(strideLength: number, legReach: number): number {
  const ratio = clamp(strideLength / Math.max(0.1, legReach * 2), 0, 0.82);
  return Math.asin(ratio);
}

export function turnStrideLength(strideLength: number, turnRadius: number): number {
  return Math.min(strideLength, Math.max(0.5, turnRadius * 0.34));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
