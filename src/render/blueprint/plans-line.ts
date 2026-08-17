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
} from './parts';
import type { BlueprintPart, Plan } from './types';

/** The baseline soldier stays plain enough that the specialists read against it. */
export const humanoidPlan: Plan = (b, has, fit, identity) => {
  const sentinel = identity === 'sentinel_snl2';
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, sentinel ? 0.58 : 0.5);
  hips(parts, b);

  parts.push(shaped('centre_torso', PROFILES.hull, [0, 0, 0],
    [b.long, b.tall, b.wide], 'plate', b.pitch));
  if (sentinel) {
    for (const side of [-1, 1]) {
      parts.push(part('centre_torso', 'box',
        [b.long * 0.3, 0, side * b.wide * 0.34],
        [b.long * 0.28, b.tall * 0.72, 0.12], 'deep', b.pitch));
    }
  } else {
    parts.push(
      part('centre_torso', 'box', [b.long * 0.3, b.tall * 0.28, 0],
        [b.long * 0.32, b.tall * 0.1, b.wide * 0.84], 'deep', b.pitch),
      part('centre_torso', 'box', [b.long * 0.3, -b.tall * 0.22, 0],
        [b.long * 0.32, b.tall * 0.1, b.wide * 0.84], 'deep', b.pitch),
    );
  }
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block,
      [-b.long * 0.08, b.tall * 0.04, side * b.wide * 0.56],
      [b.long * 0.8, b.tall * 0.76, b.wide * 0.3], 'deep', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 0.82);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.5, b.tall * 0.04, 0],
      [0.22, b.tall * 1.02, b.wide], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.26;
  const headY = b.tall * 0.66;
  if (sentinel) {
    parts.push(
      part('head', 'cylinder', [headX - 0.08, headY - 0.22, 0], [0.22, 0.22, 0.22], 'deep'),
      part('head', 'box', [headX, headY, 0], [0.48, 0.42, 0.56], 'deep'),
      part('head', 'box', [headX + 0.22, headY, 0], [0.1, 0.16, 0.42], 'glass'),
      part('head', 'box', [headX - 0.02, headY + 0.24, 0], [0.38, 0.1, 0.54], 'plate'),
    );
  } else {
    parts.push(
      part('head', 'cylinder', [headX - 0.06, headY - 0.2, 0], [0.2, 0.2, 0.2], 'deep'),
      shaped('head', PROFILES.canopy, [headX, headY, 0], [0.46, 0.36, 0.44], 'deep'),
      part('head', 'box', [headX + 0.16, headY + 0.02, 0], [0.12, 0.16, 0.3], 'glass'),
      part('head', 'box', [headX + 0.02, headY + 0.19, 0], [0.34, 0.08, 0.4], 'plate'),
    );
  }
  aerials(parts, has, headX, headY + 0.16);

  for (const side of [-1, 1]) {
    hangingArm(parts, b, side, fittingFor(fit[side < 0 ? 'left_arm' : 'right_arm']),
      b.tall * 1.25, 0.24);
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

/** A sunk visor and short arms keep the brawler's weight in its chest. */
export const brawlerPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.56);
  hips(parts, b, 1.05);
  parts.push(
    shaped('centre_torso', PROFILES.barrel, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.1, b.tall * 0.5, 0],
      [b.long * 0.56, b.tall * 0.22, b.wide * 1.16], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.pauldron,
      [b.long * 0.04, b.tall * 0.28, side * b.wide * 0.68],
      [b.long * 0.72, b.tall * 0.58, b.wide * 0.36], 'plate', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 0.72);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.48, 0, 0],
      [0.24, b.tall * 0.96, b.wide * 0.98], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.4;
  const headY = b.tall * 0.24;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.2, b.tall * 0.3, b.wide * 0.54], 'deep', b.pitch),
    part('head', 'box', [headX + 0.1, headY, 0], [0.08, b.tall * 0.14, b.wide * 0.44], 'glass', b.pitch),
    part('head', 'box', [headX + 0.02, headY + b.tall * 0.2, 0], [0.24, 0.09, b.wide * 0.6], 'plate', b.pitch),
  );
  aerials(parts, has, headX - b.long * 0.4, headY + b.tall * 0.38);
  for (const side of [-1, 1]) {
    hangingArm(parts, b, side, fittingFor(fit[side < 0 ? 'left_arm' : 'right_arm']),
      b.tall * 1.05, 0.27);
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

/** The walking bunker carries its weapons in a turret instead of arms. */
export const bastionPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, 0.72);
  hips(parts, b, 1.3);
  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, 0, 0], [b.long, b.tall * 0.9, b.wide], 'plate', b.pitch),
    shaped('centre_torso', PROFILES.wedge, [b.long * 0.46, -b.tall * 0.06, 0],
      [b.long * 0.3, b.tall * 0.66, b.wide * 0.94], 'trim', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block,
      [-b.long * 0.04, -b.tall * 0.04, side * b.wide * 0.62],
      [b.long * 0.9, b.tall * 0.6, b.wide * 0.34], 'deep', b.pitch));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 0.9);
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.52, 0, 0],
      [0.28, b.tall * 0.92, b.wide * 1.04], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const turretY = b.tall * 0.62;
  parts.push(
    part('centre_torso', 'cylinder', [-b.long * 0.04, turretY - 0.12, 0],
      [b.wide * 0.68, 0.2, b.wide * 0.68], 'deep'),
    shaped('centre_torso', PROFILES.block, [0, turretY + 0.1, 0],
      [b.long * 0.6, b.tall * 0.4, b.wide * 0.62], 'plate'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    parts.push(part(location, 'box', [b.long * 0.24, turretY + 0.08, side * b.wide * 0.22],
      [b.long * 0.34, 0.22, 0.22], 'deep'));
  }
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

/** The line-holder and launcher carriage share weight, not an outline. */
export const squatPlan: Plan = (b, has, fit, identity) => {
  const bulwark = identity === 'bulwark_bwk3';
  const cairn = identity === 'cairn_crn3';
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) walkerLeg(parts, b, side, bulwark ? 0.78 : cairn ? 0.68 : 0.62);
  hips(parts, b, bulwark ? 1.38 : 1.25);

  parts.push(
    shaped('centre_torso', PROFILES.hull, [0, cairn ? -b.tall * 0.08 : 0, 0],
      [b.long, b.tall * (cairn ? 0.84 : 1), b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [b.long * 0.26, cairn ? -b.tall * 0.08 : 0, 0],
      [b.long * 0.3, b.tall * (cairn ? 0.58 : 0.7), b.wide * 0.5], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block,
      [-b.long * 0.06, 0, side * b.wide * 0.6],
      [b.long * 0.84, b.tall * 0.74, b.wide * 0.32], 'deep', b.pitch));
    if (cairn) {
      const z = side * b.wide * 0.78;
      parts.push(
        shaped(location, PROFILES.pod, [b.long * 0.02, b.tall * 0.48, z],
          [b.long * 0.68, b.tall * 1.42, b.wide * 0.46], 'plate', b.pitch),
        part(location, 'box', [b.long * 0.38, b.tall * 0.48, z],
          [0.08, b.tall * 1.08, b.wide * 0.34], 'deep', b.pitch),
      );
    } else {
      shoulderMount(parts, b, side, fittingFor(fit[location]), 0.86);
    }
  }
  if (has('hardened_mantlet')) {
    parts.push(shaped('centre_torso', PROFILES.pauldron, [b.long * 0.5, 0, 0],
      [0.26, b.tall, b.wide], 'trim', b.pitch));
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * 0.22;
  const headY = b.tall * 0.6;
  if (cairn) {
    parts.push(
      part('head', 'box', [headX, headY, 0], [0.42, 0.28, 0.58], 'deep'),
      part('head', 'box', [headX + 0.19, headY, 0], [0.1, 0.12, 0.44], 'glass'),
      part('head', 'box', [headX - 0.02, headY + 0.18, 0], [0.34, 0.08, 0.56], 'plate'),
    );
  } else {
    parts.push(
      shaped('head', PROFILES.canopy, [headX, headY, 0], [0.44, 0.34, 0.46], 'deep'),
      part('head', 'box', [headX + 0.15, headY + 0.02, 0], [0.12, 0.15, 0.3], 'glass'),
      part('head', 'box', [headX, headY + 0.18, 0], [0.36, 0.08, 0.44], 'plate'),
    );
  }
  aerials(parts, has, headX, headY + 0.16);

  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    hangingArm(parts, b, side, fittingFor(fit[location]),
      b.tall * (cairn ? 1.02 : 1.1), cairn ? 0.18 : 0.26);
  }
  if (!cairn) {
    parts.push(shaped('left_arm', PROFILES.pauldron,
      [b.long * 0.16, -b.tall * 0.24, -b.shoulder * (bulwark ? 1.38 : 1.24)],
      [b.long * (bulwark ? 0.84 : 0.72), b.tall * (bulwark ? 1.28 : 1.1), bulwark ? 0.2 : 0.16],
      'trim', b.pitch));
  }

  return {
    parts,
    hardpoints: {
      left_arm: [b.long * 0.16, -b.tall * 0.66, -b.shoulder],
      right_arm: [b.long * 0.16, -b.tall * 0.66, b.shoulder],
      left_torso: [b.long * 0.34, b.tall * 0.42, -b.wide * 0.78],
      right_torso: [b.long * 0.34, b.tall * 0.42, b.wide * 0.78],
      centre_torso: [b.long * 0.46, b.tall * 0.16, 0],
      head: [headX, b.tall * 0.6 + 0.24, 0],
    },
    crown: b.tall * (cairn ? 1.2 : 0.86),
  };
};
