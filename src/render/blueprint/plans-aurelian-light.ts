import { PROFILES } from './profiles';
import { armoured, part, shaped } from './parts';
import { sealedBirdLeg, sealedHips } from './plans-aurelian-parts';
import type { BlueprintPart, Plan, Profile } from './types';

const VESPER_SHELL: Profile = [
  [-0.5, -0.12],
  [-0.34, -0.4],
  [0.12, -0.48],
  [0.5, -0.1],
  [0.4, 0.24],
  [0.06, 0.46],
  [-0.42, 0.34],
];

const VOTIVE_SHELL: Profile = [
  [-0.48, -0.18],
  [-0.32, -0.48],
  [0.18, -0.5],
  [0.5, -0.18],
  [0.46, 0.24],
  [0.18, 0.5],
  [-0.28, 0.46],
  [-0.5, 0.16],
];

/** A thin sealed spindle leaves the scout's mass in its legs and sensor face. */
export const vesperPlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedBirdLeg(parts, b, side, 0.44, 0.82);
  sealedHips(parts, b, 0.82);

  parts.push(
    armoured('centre_torso', VESPER_SHELL, [0, -b.tall * 0.02, 0],
      [b.long * 0.94, b.tall * 0.72, b.wide * 0.72], 'plate',
      { front: 0.52, rear: 0.82, top: 0.68, bottom: 0.8, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [-b.long * 0.32, b.tall * 0.22, 0],
      [b.long * 0.28, b.tall * 0.22, b.wide * 0.48], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, PROFILES.pod, [-b.long * 0.12, b.tall * 0.16, side * b.wide * 0.5],
        [b.long * 0.38, b.tall * 0.3, b.wide * 0.22], 'deep',
        { front: 0.58, rear: 0.84, top: 0.72, bottom: 0.8, edge: 0.07 }, b.pitch),
      armoured(arm, PROFILES.wedge, [b.long * 0.08, -b.tall * 0.14, armZ],
        [b.long * 0.42, b.tall * 0.5, b.wide * 0.2], 'plate',
        { front: 0.5, rear: 0.8, top: 0.74, bottom: 0.76, edge: 0.08 }, b.pitch),
    );
  }

  const headX = b.long * 0.38;
  const headY = b.tall * 0.2;
  parts.push(
    armoured('head', VESPER_SHELL, [headX, headY, 0],
      [b.long * 0.28, b.tall * 0.2, b.wide * 0.34], 'deep',
      { front: 0.5, rear: 0.82, top: 0.68, bottom: 0.78, edge: 0.08 }, b.pitch),
    part('head', 'box', [headX + b.long * 0.13, headY, 0],
      [0.06, b.tall * 0.08, b.wide * 0.24], 'glass', b.pitch),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.3, -b.tall * 0.2, -b.shoulder],
      right_arm: [b.long * 0.3, -b.tall * 0.2, b.shoulder],
      left_torso: [b.long * 0.16, b.tall * 0.16, -b.wide * 0.5],
      right_torso: [b.long * 0.16, b.tall * 0.16, b.wide * 0.5],
      centre_torso: [b.long * 0.4, b.tall * 0.02, 0],
      head: [headX + b.long * 0.1, headY + b.tall * 0.14, 0],
    },
    crown: b.tall * 0.58,
  };
};

/** The light Stock hull is one sealed seed with its weapons hung in paired sleeves. */
export const votivePlan: Plan = (b) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) sealedBirdLeg(parts, b, side, 0.58, 1);

  parts.push(
    shaped(null, PROFILES.wedge, [-b.long * 0.08, b.hip, 0],
      [b.long * 0.48, 0.22, b.spread * 2.1], 'deep'),
    armoured('centre_torso', VOTIVE_SHELL, [0, 0, 0],
      [b.long, b.tall, b.wide * 0.82], 'plate',
      { front: 0.58, rear: 0.84, top: 0.7, bottom: 0.82, edge: 0.08 }, b.pitch),
    shaped('centre_torso', PROFILES.wedge, [-b.long * 0.32, b.tall * 0.28, 0],
      [b.long * 0.36, b.tall * 0.28, b.wide * 0.54], 'deep', b.pitch),
  );

  for (const side of [-1, 1]) {
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    const armZ = side * b.shoulder;
    parts.push(
      armoured(torso, PROFILES.pod, [-b.long * 0.08, b.tall * 0.2, side * b.wide * 0.56],
        [b.long * 0.5, b.tall * 0.42, b.wide * 0.3], 'deep',
        { front: 0.62, rear: 0.88, top: 0.72, bottom: 0.86, edge: 0.07 }, b.pitch),
      armoured(arm, PROFILES.wedge, [b.long * 0.04, -b.tall * 0.12, armZ],
        [b.long * 0.62, b.tall * 0.62, b.wide * 0.28], 'plate',
        { front: 0.56, rear: 0.82, top: 0.76, bottom: 0.76, edge: 0.08 }, b.pitch),
      part(arm, 'box', [b.long * 0.31, -b.tall * 0.12, armZ],
        [0.07, b.tall * 0.28, b.wide * 0.18], 'glass', b.pitch),
    );
  }

  const headX = b.long * 0.34;
  const headY = b.tall * 0.28;
  parts.push(
    armoured('head', PROFILES.wedge, [headX, headY, 0],
      [b.long * 0.34, b.tall * 0.26, b.wide * 0.42], 'deep',
      { front: 0.6, rear: 0.86, top: 0.72, bottom: 0.8, edge: 0.08 }, b.pitch),
    part('head', 'box', [headX + b.long * 0.15, headY, 0],
      [0.07, b.tall * 0.1, b.wide * 0.28], 'glass', b.pitch),
  );

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.36, -b.tall * 0.2, -b.shoulder],
      right_arm: [b.long * 0.36, -b.tall * 0.2, b.shoulder],
      left_torso: [b.long * 0.22, b.tall * 0.2, -b.wide * 0.56],
      right_torso: [b.long * 0.22, b.tall * 0.2, b.wide * 0.56],
      centre_torso: [b.long * 0.42, b.tall * 0.06, 0],
      head: [headX + b.long * 0.12, headY + b.tall * 0.18, 0],
    },
    crown: b.tall * 0.72,
  };
};
