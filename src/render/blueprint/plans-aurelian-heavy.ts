import { PROFILES } from './profiles';
import { armoured, part, shaped } from './parts';
import { sealedBirdLeg, sealedHips, sealedWalkerLeg } from './plans-aurelian-parts';
import type { BlueprintPart, Plan, Profile } from './types';

const WARDEN_SHELL: Profile = [
  [-0.5, -0.28],
  [-0.26, -0.48],
  [0.32, -0.44],
  [0.5, -0.14],
  [0.42, 0.28],
  [0.12, 0.44],
  [-0.4, 0.38],
];

const HALBERD_SHELL: Profile = [
  [-0.48, -0.36],
  [-0.2, -0.5],
  [0.32, -0.42],
  [0.5, -0.08],
  [0.38, 0.34],
  [0.08, 0.5],
  [-0.4, 0.36],
  [-0.5, 0],
];

/** The command hull keeps its armour low and continuous across both shoulders. */
export const wardenSealedPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedWalkerLeg(parts, b, side, 0.64, 1.08);
  sealedHips(parts, b, 1.14);

  parts.push(
    armoured('centre_torso', WARDEN_SHELL, [-b.long * 0.04, -b.tall * 0.04, 0],
      [b.long, b.tall * 0.86, b.wide * 0.94], 'plate',
      { front: 0.6, rear: 0.9, top: 0.68, bottom: 0.84, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.43, -b.tall * 0.04, 0],
      [b.long * 0.22, b.tall * 0.56, b.wide * 0.7], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, WARDEN_SHELL, [-b.long * 0.1, b.tall * 0.22, side * b.wide * 0.6],
        [b.long * 0.7, b.tall * 0.52, b.wide * 0.36], 'deep',
        { front: 0.64, rear: 0.9, top: 0.68, bottom: 0.84, edge: 0.08 }, b.pitch),
      armoured(arm, PROFILES.shield, [b.long * 0.02, -b.tall * 0.34, armZ],
        [b.long * 0.5, b.tall * 0.88, b.wide * 0.32], 'plate',
        { front: 0.56, rear: 0.86, top: 0.72, bottom: 0.78, edge: 0.08 }, b.pitch),
      part(arm, 'box', [b.long * 0.26, -b.tall * 0.34, armZ],
        [0.08, b.tall * 0.34, b.wide * 0.2], 'glass', b.pitch),
    );
  }

  const headX = b.long * 0.3;
  const headY = b.tall * 0.36;
  parts.push(
    armoured('head', WARDEN_SHELL, [headX, headY, 0],
      [b.long * 0.4, b.tall * 0.3, b.wide * 0.58], 'deep',
      { front: 0.58, rear: 0.86, top: 0.7, bottom: 0.82, edge: 0.08 }, b.pitch),
    part('head', 'box', [headX + b.long * 0.19, headY, 0],
      [0.08, b.tall * 0.1, b.wide * 0.42], 'glass', b.pitch),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.34, -b.tall * 0.42, -b.shoulder],
      right_arm: [b.long * 0.34, -b.tall * 0.42, b.shoulder],
      left_torso: [b.long * 0.3, b.tall * 0.22, -b.wide * 0.6],
      right_torso: [b.long * 0.3, b.tall * 0.22, b.wide * 0.6],
      centre_torso: [b.long * 0.52, -b.tall * 0.04, 0],
      head: [headX + b.long * 0.16, headY + b.tall * 0.2, 0],
    },
    crown: b.tall * 0.7,
  };
};

/** Paired shoulder vaults replace the carrier's exposed magazines and radiators. */
export const halberdSealedPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedBirdLeg(parts, b, side, 0.66, 1.02);
  sealedHips(parts, b, 1.06);

  parts.push(
    armoured('centre_torso', HALBERD_SHELL, [-b.long * 0.04, 0, 0],
      [b.long, b.tall * 0.92, b.wide * 0.88], 'plate',
      { front: 0.58, rear: 0.9, top: 0.68, bottom: 0.82, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.44, 0, 0],
      [b.long * 0.2, b.tall * 0.6, b.wide * 0.64], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torsoZ = side * b.wide * 0.72;
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, HALBERD_SHELL, [-b.long * 0.12, b.tall * 0.62, torsoZ],
        [b.long * 0.68, b.tall * 1.28, b.wide * 0.42], 'deep',
        { front: 0.6, rear: 0.9, top: 0.66, bottom: 0.84, edge: 0.08 }, b.pitch),
      part(torso, 'box', [b.long * 0.2, b.tall * 0.62, torsoZ],
        [0.08, b.tall * 0.66, b.wide * 0.26], 'glass', b.pitch),
      armoured(arm, PROFILES.wedge, [b.long * 0.08, -b.tall * 0.16, armZ],
        [b.long * 0.54, b.tall * 0.58, b.wide * 0.3], 'plate',
        { front: 0.54, rear: 0.84, top: 0.72, bottom: 0.78, edge: 0.08 }, b.pitch),
    );
  }

  const headX = b.long * 0.32;
  const headY = b.tall * 0.26;
  parts.push(
    armoured('head', HALBERD_SHELL, [headX, headY, 0],
      [b.long * 0.34, b.tall * 0.26, b.wide * 0.48], 'deep',
      { front: 0.56, rear: 0.84, top: 0.68, bottom: 0.8, edge: 0.08 }, b.pitch),
    part('head', 'box', [headX + b.long * 0.16, headY, 0],
      [0.07, b.tall * 0.08, b.wide * 0.34], 'glass', b.pitch),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.36, -b.tall * 0.2, -b.shoulder],
      right_arm: [b.long * 0.36, -b.tall * 0.2, b.shoulder],
      left_torso: [b.long * 0.3, b.tall * 0.62, -b.wide * 0.72],
      right_torso: [b.long * 0.3, b.tall * 0.62, b.wide * 0.72],
      centre_torso: [b.long * 0.5, 0, 0],
      head: [headX + b.long * 0.14, headY + b.tall * 0.18, 0],
    },
    crown: b.tall * 1.32,
  };
};
