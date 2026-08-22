import { PROFILES } from './profiles';
import { armoured, part, shaped } from './parts';
import { sealedHips, sealedWalkerLeg } from './plans-aurelian-parts';
import type { BlueprintPart, Plan, Profile } from './types';

const MONOLITH_SHELL: Profile = [
  [-0.48, -0.36],
  [-0.22, -0.5],
  [0.3, -0.46],
  [0.5, -0.16],
  [0.46, 0.32],
  [0.2, 0.5],
  [-0.3, 0.46],
  [-0.5, 0.16],
];

const VAULT_SHELL: Profile = [
  [-0.5, -0.26],
  [-0.3, -0.46],
  [0.3, -0.46],
  [0.5, -0.2],
  [0.46, 0.18],
  [0.22, 0.42],
  [-0.34, 0.42],
  [-0.5, 0.16],
];

/** A tall sealed column whose three projectors sit on one unbroken frontage. */
export const obsequyPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedWalkerLeg(parts, b, side, 0.62, 0.96);
  sealedHips(parts, b, 1.02);

  parts.push(
    armoured('centre_torso', MONOLITH_SHELL, [-b.long * 0.06, b.tall * 0.08, 0],
      [b.long * 0.9, b.tall * 1.08, b.wide * 0.72], 'plate',
      { front: 0.62, rear: 0.9, top: 0.7, bottom: 0.84, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.36, b.tall * 0.08, 0],
      [b.long * 0.22, b.tall * 0.72, b.wide * 0.54], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const shoulderZ = side * b.shoulder;
    parts.push(
      armoured(torso, PROFILES.pauldron,
        [-b.long * 0.12, b.tall * 0.34, side * b.wide * 0.55],
        [b.long * 0.62, b.tall * 0.58, b.wide * 0.34], 'deep',
        { front: 0.66, rear: 0.9, top: 0.68, bottom: 0.84, edge: 0.08 }, b.pitch),
      armoured(arm, PROFILES.wedge, [b.long * 0.02, -b.tall * 0.28, shoulderZ],
        [b.long * 0.54, b.tall * 1.02, b.wide * 0.28], 'plate',
        { front: 0.58, rear: 0.86, top: 0.74, bottom: 0.74, edge: 0.08 }, b.pitch),
      part(arm, 'box', [b.long * 0.27, -b.tall * 0.28, shoulderZ],
        [0.08, b.tall * 0.44, b.wide * 0.18], 'glass', b.pitch),
    );
  }

  const headX = b.long * 0.18;
  const headY = b.tall * 0.72;
  parts.push(
    armoured('head', MONOLITH_SHELL, [headX, headY, 0],
      [b.long * 0.36, b.tall * 0.44, b.wide * 0.48], 'deep',
      { front: 0.64, rear: 0.88, top: 0.72, bottom: 0.82, edge: 0.08 }),
    part('head', 'box', [headX + b.long * 0.17, headY, 0],
      [0.08, b.tall * 0.14, b.wide * 0.34], 'glass'),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.34, -b.tall * 0.38, -b.shoulder],
      right_arm: [b.long * 0.34, -b.tall * 0.38, b.shoulder],
      left_torso: [b.long * 0.26, b.tall * 0.32, -b.wide * 0.55],
      right_torso: [b.long * 0.26, b.tall * 0.32, b.wide * 0.55],
      centre_torso: [b.long * 0.48, b.tall * 0.08, 0],
      head: [headX + b.long * 0.14, headY + b.tall * 0.28, 0],
    },
    crown: b.tall * 1.02,
  };
};

/** The heaviest Stock hull is a low vault with every aperture on its centreline. */
export const pallvaultPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedWalkerLeg(parts, b, side, 0.78, 1.12);
  sealedHips(parts, b, 1.18);

  parts.push(
    armoured('centre_torso', VAULT_SHELL, [-b.long * 0.04, -b.tall * 0.06, 0],
      [b.long * 1.08, b.tall * 0.86, b.wide * 1.12], 'plate',
      { front: 0.58, rear: 0.92, top: 0.66, bottom: 0.82, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.46, -b.tall * 0.08, 0],
      [b.long * 0.24, b.tall * 0.54, b.wide * 0.82], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torsoZ = side * b.wide * 0.62;
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, VAULT_SHELL, [-b.long * 0.08, b.tall * 0.08, torsoZ],
        [b.long * 0.78, b.tall * 0.64, b.wide * 0.38], 'deep',
        { front: 0.62, rear: 0.9, top: 0.66, bottom: 0.84, edge: 0.08 }, b.pitch),
      part(torso, 'box', [b.long * 0.3, b.tall * 0.08, torsoZ],
        [0.08, b.tall * 0.18, b.wide * 0.22], 'glass', b.pitch),
      armoured(arm, PROFILES.wedge, [b.long * 0.02, -b.tall * 0.4, armZ],
        [b.long * 0.58, b.tall * 0.72, b.wide * 0.34], 'plate',
        { front: 0.58, rear: 0.86, top: 0.72, bottom: 0.78, edge: 0.08 }, b.pitch),
      part(arm, 'box', [b.long * 0.3, -b.tall * 0.4, armZ],
        [0.08, b.tall * 0.3, b.wide * 0.22], 'glass', b.pitch),
    );
  }

  const headX = b.long * 0.28;
  const headY = b.tall * 0.32;
  parts.push(
    armoured('head', PROFILES.wedge, [headX, headY, 0],
      [b.long * 0.42, b.tall * 0.3, b.wide * 0.62], 'deep',
      { front: 0.6, rear: 0.88, top: 0.7, bottom: 0.82, edge: 0.08 }, b.pitch),
    part('head', 'box', [headX + b.long * 0.2, headY, 0],
      [0.08, b.tall * 0.1, b.wide * 0.46], 'glass', b.pitch),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.36, -b.tall * 0.46, -b.shoulder],
      right_arm: [b.long * 0.36, -b.tall * 0.46, b.shoulder],
      left_torso: [b.long * 0.38, b.tall * 0.08, -b.wide * 0.62],
      right_torso: [b.long * 0.38, b.tall * 0.08, b.wide * 0.62],
      centre_torso: [b.long * 0.54, -b.tall * 0.08, 0],
      head: [headX + b.long * 0.18, headY + b.tall * 0.2, 0],
    },
    crown: b.tall * 0.72,
  };
};
