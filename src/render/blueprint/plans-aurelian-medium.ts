import { PROFILES } from './profiles';
import { armoured, part, shaped } from './parts';
import { sealedHips, sealedWalkerLeg } from './plans-aurelian-parts';
import type { BlueprintPart, Plan, Profile } from './types';

const SENTINEL_SHELL: Profile = [
  [-0.5, -0.34],
  [-0.24, -0.5],
  [0.28, -0.46],
  [0.5, -0.18],
  [0.46, 0.24],
  [0.18, 0.46],
  [-0.34, 0.42],
  [-0.5, 0.12],
];

const FALCHION_SHELL: Profile = [
  [-0.46, -0.4],
  [-0.12, -0.5],
  [0.34, -0.4],
  [0.5, 0],
  [0.3, 0.42],
  [-0.04, 0.5],
  [-0.42, 0.3],
  [-0.5, -0.08],
];

/** Broad cheek plates make the medium line-holder read as one closed shield. */
export const sentinelSealedPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedWalkerLeg(parts, b, side, 0.58, 1.04);
  sealedHips(parts, b, 1.08);

  parts.push(
    armoured('centre_torso', SENTINEL_SHELL, [-b.long * 0.04, 0, 0],
      [b.long, b.tall * 0.94, b.wide * 0.86], 'plate',
      { front: 0.62, rear: 0.9, top: 0.7, bottom: 0.84, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.keel, [b.long * 0.4, 0, 0],
      [b.long * 0.2, b.tall * 0.68, b.wide * 0.62], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, PROFILES.pauldron, [-b.long * 0.08, b.tall * 0.26, side * b.wide * 0.58],
        [b.long * 0.66, b.tall * 0.58, b.wide * 0.34], 'deep',
        { front: 0.64, rear: 0.9, top: 0.7, bottom: 0.84, edge: 0.08 }, b.pitch),
      armoured(arm, PROFILES.shield, [b.long * 0.04, -b.tall * 0.26, armZ],
        [b.long * 0.5, b.tall * 0.9, b.wide * 0.3], 'plate',
        { front: 0.58, rear: 0.86, top: 0.74, bottom: 0.78, edge: 0.08 }, b.pitch),
      part(arm, 'box', [b.long * 0.28, -b.tall * 0.26, armZ],
        [0.07, b.tall * 0.34, b.wide * 0.2], 'glass', b.pitch),
    );
  }

  const headX = b.long * 0.24;
  const headY = b.tall * 0.54;
  parts.push(
    armoured('head', SENTINEL_SHELL, [headX, headY, 0],
      [b.long * 0.38, b.tall * 0.34, b.wide * 0.54], 'deep',
      { front: 0.62, rear: 0.88, top: 0.72, bottom: 0.82, edge: 0.08 }),
    part('head', 'box', [headX + b.long * 0.18, headY, 0],
      [0.07, b.tall * 0.1, b.wide * 0.4], 'glass'),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.34, -b.tall * 0.34, -b.shoulder],
      right_arm: [b.long * 0.34, -b.tall * 0.34, b.shoulder],
      left_torso: [b.long * 0.3, b.tall * 0.26, -b.wide * 0.58],
      right_torso: [b.long * 0.3, b.tall * 0.26, b.wide * 0.58],
      centre_torso: [b.long * 0.48, 0, 0],
      head: [headX + b.long * 0.16, headY + b.tall * 0.22, 0],
    },
    crown: b.tall * 0.82,
  };
};

/** Long tapered limbs continue the duellist's narrow hull without exposing a joint. */
export const falchionSealedPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedWalkerLeg(parts, b, side, 0.52, 0.88);
  sealedHips(parts, b, 0.9);

  parts.push(
    armoured('centre_torso', FALCHION_SHELL, [0, b.tall * 0.02, 0],
      [b.long * 0.9, b.tall, b.wide * 0.68], 'plate',
      { front: 0.54, rear: 0.86, top: 0.68, bottom: 0.8, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.38, b.tall * 0.02, 0],
      [b.long * 0.18, b.tall * 0.74, b.wide * 0.46], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, PROFILES.wedge, [-b.long * 0.16, b.tall * 0.38, side * b.wide * 0.5],
        [b.long * 0.54, b.tall * 0.34, b.wide * 0.26], 'deep',
        { front: 0.56, rear: 0.84, top: 0.68, bottom: 0.82, edge: 0.08 }, b.pitch),
      armoured(arm, FALCHION_SHELL, [b.long * 0.02, -b.tall * 0.34, armZ],
        [b.long * 0.4, b.tall * 1.08, b.wide * 0.24], 'plate',
        { front: 0.52, rear: 0.82, top: 0.72, bottom: 0.74, edge: 0.08 }, b.pitch),
      part(arm, 'box', [b.long * 0.21, -b.tall * 0.34, armZ],
        [0.06, b.tall * 0.48, b.wide * 0.16], 'glass', b.pitch),
    );
  }

  const headX = b.long * 0.28;
  const headY = b.tall * 0.62;
  parts.push(
    armoured('head', FALCHION_SHELL, [headX, headY, 0],
      [b.long * 0.3, b.tall * 0.32, b.wide * 0.4], 'deep',
      { front: 0.54, rear: 0.84, top: 0.68, bottom: 0.8, edge: 0.08 }),
    part('head', 'box', [headX + b.long * 0.14, headY, 0],
      [0.06, b.tall * 0.08, b.wide * 0.28], 'glass'),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.28, -b.tall * 0.46, -b.shoulder],
      right_arm: [b.long * 0.28, -b.tall * 0.46, b.shoulder],
      left_torso: [b.long * 0.2, b.tall * 0.38, -b.wide * 0.5],
      right_torso: [b.long * 0.2, b.tall * 0.38, b.wide * 0.5],
      centre_torso: [b.long * 0.46, b.tall * 0.02, 0],
      head: [headX + b.long * 0.12, headY + b.tall * 0.2, 0],
    },
    crown: b.tall * 0.92,
  };
};
