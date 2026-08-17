import { PROFILES } from './profiles';
import {
  aerials,
  fittingFor,
  hangingArm,
  hips,
  part,
  radiators,
  shaped,
  shoulderMount,
  walkerLeg,
  birdLeg,
} from './parts';
import type { BlueprintPart, Plan } from './types';

/** A hundred tonnes hunched behind a face and a wall of front armour. */
export const siegePlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.68);
  hips(parts, b, 1.2);

  parts.push(
    shaped('centre_torso', PROFILES.barrel, [0, b.tall * 0.08, 0], [b.long, b.tall * 0.94, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.02, -b.tall * 0.46, 0],
      [b.long * 0.66, b.tall * 0.26, b.wide * 0.62], 'deep'),
    part('centre_torso', 'box', [-b.long * 0.14, b.tall * 0.56, 0],
      [b.long * 0.6, b.tall * 0.2, b.wide * 0.78], 'deep'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block,
      [-b.long * 0.06, 0, side * b.wide * 0.58],
      [b.long * 0.86, b.tall * 0.82, b.wide * 0.3], 'deep', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 1, 1.16, 0.72);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.48, 0, 0],
      [0.26, b.tall * 1.02, b.wide * 1.02], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.36;
  const headY = b.tall * 0.72;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.62, 0.5, 0.66], 'deep'),
    part('head', 'box', [headX + 0.14, headY + 0.3, 0], [0.6, 0.16, 0.76], 'plate'),
    shaped('head', PROFILES.jaw, [headX + 0.06, headY - 0.34, 0], [0.56, 0.3, 0.56], 'plate'),
    part('head', 'box', [headX + 0.24, headY - 0.36, 0], [0.14, 0.14, 0.36], 'accent'),
    part('head', 'box', [headX - 0.04, headY - 0.04, 0], [0.42, 0.3, 0.78], 'plate'),
  );
  for (const side of [-1, 1]) {
    parts.push(part('head', 'box', [headX + 0.3, headY + 0.06, side * 0.19], [0.1, 0.14, 0.2], 'glass'));
  }
  aerials(parts, has, headX - 0.3, headY + 0.24);

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
    crown: b.tall,
  };
};

/** The shoulder pods have to dominate a carrier even when it is standing still. */
export const battlePlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) birdLeg(parts, b, side, 0.66);
  hips(parts, b, 0.9);

  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall, b.wide * 1.1], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.22, b.tall * 0.52, 0],
      [b.long * 0.6, b.tall * 0.3, b.wide * 0.66], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(
      shaped(location, PROFILES.pod, [-b.long * 0.06, b.tall, side * b.wide],
        [b.long * 0.66, b.tall * 1.15, b.wide * 0.62], 'plate', b.pitch + 0.1),
      part(location, 'box', [b.long * 0.28, b.tall, side * b.wide],
        [0.08, b.tall * 0.9, b.wide * 0.46], 'deep', b.pitch + 0.1),
      part(location, 'box', [-b.long * 0.08, b.tall * 1.6, side * b.wide],
        [b.long * 0.5, 0.1, b.wide * 0.5], 'deep', b.pitch + 0.1),
      part(location, 'box', [-b.long * 0.14, b.tall * 0.6, side * b.wide * 0.66],
        [b.long * 0.3, b.tall * 0.7, b.wide * 0.3], 'deep'),
    );
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.42;
  const headY = b.tall * 0.16;
  parts.push(
    shaped('head', PROFILES.wedge, [headX, headY, 0],
      [b.long * 0.34, b.tall * 0.42, b.wide * 0.5], 'deep', b.pitch),
    part('head', 'box', [headX + 0.1, headY + 0.04, 0],
      [0.14, b.tall * 0.2, b.wide * 0.34], 'glass', b.pitch),
    part('head', 'box', [headX - 0.04, headY + b.tall * 0.26, 0],
      [b.long * 0.2, 0.08, b.wide * 0.42], 'plate', b.pitch),
  );
  aerials(parts, has, headX - b.long * 0.3, headY + b.tall * 0.4);

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
      parts.push(part(location, 'box', [b.long * 0.28, -b.tall * 0.06, z],
        [0.1, b.tall * 0.24, b.wide * 0.2], 'deep'));
    }
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.36, -b.tall * 0.06, -b.shoulder],
      right_arm: [b.long * 0.36, -b.tall * 0.06, b.shoulder],
      left_torso: [b.long * 0.3, b.tall, -b.wide],
      right_torso: [b.long * 0.3, b.tall, b.wide],
      centre_torso: [b.long * 0.44, b.tall * 0.4, 0],
      head: [headX, headY + b.tall * 0.34, 0],
    },
    crown: b.tall * 1.7,
  };
};
