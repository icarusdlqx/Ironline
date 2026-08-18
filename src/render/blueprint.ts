import type { Silhouette } from './shape';
import { emplacementPlan, trackedPlan, wheeledPlan } from './blueprint/plans-ground';
import { battlePlan, siegePlan } from './blueprint/plans-heavy';
import { birdPlan, scoutPlan } from './blueprint/plans-light';
import { bastionPlan, brawlerPlan, humanoidPlan, squatPlan } from './blueprint/plans-line';
import type { Blueprint, Bones, HardpointMap, Plan } from './blueprint/types';

export type {
  Blueprint,
  BlueprintPart,
  HardpointCount,
  HardpointMap,
  LegJoint,
  PartShape,
  Profile,
  Tone,
} from './blueprint/types';

/** Base proportions before a chassis and its visible traits mark the plan. */
const BASE: Record<Silhouette['form'], Bones> = {
  scout: { hip: 1.2, spread: 0.3, kneeHeight: 0.66, knee: 0.3, thigh: 0.19, long: 0.8, wide: 0.56, tall: 0.5, pitch: 0.2, shoulder: 0.4 },
  bird: { hip: 1.24, spread: 0.36, kneeHeight: 0.7, knee: 0.34, thigh: 0.24, long: 1, wide: 0.7, tall: 0.6, pitch: 0.24, shoulder: 0.56 },
  humanoid: { hip: 1, spread: 0.4, kneeHeight: 0.48, knee: 0, thigh: 0.28, long: 0.94, wide: 0.84, tall: 0.84, pitch: 0.04, shoulder: 0.7 },
  brawler: { hip: 0.94, spread: 0.46, kneeHeight: 0.44, knee: 0, thigh: 0.32, long: 0.92, wide: 1, tall: 0.82, pitch: 0.1, shoulder: 0.78 },
  battle: { hip: 1.34, spread: 0.44, kneeHeight: 0.76, knee: 0.4, thigh: 0.3, long: 1.14, wide: 0.9, tall: 0.62, pitch: 0.18, shoulder: 0.86 },
  squat: { hip: 0.92, spread: 0.56, kneeHeight: 0.42, knee: 0, thigh: 0.34, long: 1, wide: 1.14, tall: 0.72, pitch: 0.02, shoulder: 0.88 },
  bastion: { hip: 0.88, spread: 0.62, kneeHeight: 0.4, knee: -0.04, thigh: 0.38, long: 1.16, wide: 1.24, tall: 0.7, pitch: 0, shoulder: 0.96 },
  siege: { hip: 0.98, spread: 0.58, kneeHeight: 0.46, knee: 0, thigh: 0.4, long: 1.08, wide: 1.2, tall: 0.94, pitch: 0.08, shoulder: 1.02 },
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
 * Builds one description for both the bay drawing and battlefield model.
 * Identity is render-only: it selects the large construction cues that
 * proportions cannot express without turning one shared plan into two.
 */
export function chassisBlueprint(
  shape: Silhouette,
  traits: readonly string[],
  fit: HardpointMap = {},
  identity: string | null = null,
): Blueprint {
  const base = BASE[shape.form];
  const has = (trait: string): boolean => traits.includes(trait);
  const gadfly = identity === 'hornet_hnt2';

  const bones: Bones = {
    ...base,
    hip: base.hip * shape.legLength * (has('long_stride') ? 1.1 : 1),
    kneeHeight: base.kneeHeight * shape.legLength * (has('long_stride') ? 1.1 : 1),
    knee: base.knee * shape.legLength * (gadfly ? 1.3 : 1),
    spread: base.spread * shape.stance * (has('wide_stance') ? 1.22 : 1) * (gadfly ? 1.06 : 1),
    thigh: base.thigh * (has('reinforced_legs') ? 1.22 : 1) * Math.min(1.25, 0.6 + shape.torsoWidth * 0.5),
    long: base.long * shape.torsoLength,
    wide: base.wide * shape.torsoWidth * (has('narrow_profile') ? 0.84 : 1),
    shoulder: base.shoulder * shape.shoulder,
  };

  const built = PLANS[shape.form](bones, has, fit, identity);
  const torsoY = bones.hip + bones.tall * 0.5;
  const reversed = shape.form === 'scout' || shape.form === 'bird' || shape.form === 'battle';
  const ankleHeight = bones.kneeHeight * (reversed ? 0.12 : 0.14);
  const ankleForward = 0;
  const legReach =
    Math.hypot(bones.hip - bones.kneeHeight, bones.knee) +
    Math.hypot(bones.kneeHeight - ankleHeight, bones.knee - ankleForward);
  const stanceReach = Math.hypot(bones.hip - ankleHeight, ankleForward);

  return {
    parts: built.parts,
    hardpoints: built.hardpoints,
    torsoY,
    height: torsoY + built.crown,
    legs: {
      hipHeight: bones.hip,
      kneeHeight: bones.kneeHeight,
      kneeForward: bones.knee,
      ankleHeight,
      ankleForward,
      reach: legReach,
      stanceReach,
      stanceWidth: bones.spread,
    },
    articulated: WALKS.has(shape.form),
  };
}
