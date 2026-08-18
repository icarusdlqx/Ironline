import { PROFILES } from './profiles';
import {
  aerials,
  armoured,
  birdLeg,
  fittingFor,
  hips,
  part,
  radiators,
  shaped,
} from './parts';
import type { BlueprintPart, Plan } from './types';

/** A forward cockpit and reversed legs make the harasser read nose-first. */
export const birdPlan: Plan = (b, has, fit, identity) => {
  const gadfly = identity === 'hornet_hnt2';
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) birdLeg(parts, b, side, gadfly ? 0.76 : 0.6);
  hips(parts, b, gadfly ? 0.72 : 0.85);

  parts.push(
    gadfly
      ? armoured('centre_torso', PROFILES.beak, [-b.long * 0.12, b.tall * 0.02, 0],
        [b.long * 0.78, b.tall * 0.8, b.wide * 0.78], 'plate',
        { front: 0.58, rear: 0.94, top: 0.72, edge: 0.08 }, b.pitch)
      : shaped('centre_torso', PROFILES.hull, [0, 0, 0],
        [b.long, b.tall, b.wide], 'plate', b.pitch),
    shaped('centre_torso', gadfly ? PROFILES.pauldron : PROFILES.block,
      [-b.long * (gadfly ? 0.38 : 0.34), b.tall * (gadfly ? 0.42 : 0.4), 0],
      [b.long * (gadfly ? 0.44 : 0.34), b.tall * (gadfly ? 0.2 : 0.3),
        b.wide * (gadfly ? 1.35 : 0.6)], 'deep', b.pitch),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    const nacelleOut = gadfly ? 0.96 : 0.84;
    parts.push(
      gadfly
        ? armoured(location, PROFILES.pod,
          [-b.long * 0.14, b.tall * 0.28, side * b.wide * nacelleOut],
          [b.long * 0.5, b.tall * 0.34, b.wide * 0.28], 'plate',
          { front: 0.62, rear: 0.92, top: 0.76, edge: 0.07 }, b.pitch)
        : shaped(location, PROFILES.pod,
          [-b.long * 0.02, b.tall * 0.18, side * b.wide * nacelleOut],
          [b.long * 0.66, b.tall * 0.5, b.wide * 0.36], 'plate', b.pitch),
      part(location, 'box',
        [b.long * (gadfly ? 0.12 : 0.28), b.tall * (gadfly ? 0.28 : 0.18),
          side * b.wide * nacelleOut],
        [0.07, b.tall * (gadfly ? 0.22 : 0.3), b.wide * 0.24], 'deep', b.pitch),
    );
    if (fittingFor(fit[location]) === 'cannon') {
      parts.push(part(location, 'cylinder',
        [-b.long * 0.22, b.tall * 0.18, side * b.wide * nacelleOut],
        [b.tall * 0.34, b.wide * 0.26, b.tall * 0.34], 'deep', Math.PI / 2));
    }
  }
  if (has('oversized_sinks')) radiators(parts, b);

  const headX = b.long * (gadfly ? 0.78 : 0.56);
  const headY = b.tall * (gadfly ? 0.22 : 0.34);
  parts.push(
    part('head', 'cylinder', [headX - (gadfly ? 0.22 : 0.16), headY - 0.06, 0],
      [0.16, gadfly ? 0.3 : 0.22, 0.16], 'deep'),
    gadfly
      ? armoured('head', PROFILES.beak, [headX, headY, 0], [0.76, 0.3, 0.38],
        'deep', { front: 0.48, rear: 0.9, top: 0.7, edge: 0.07 }, b.pitch)
      : shaped('head', PROFILES.wedge, [headX, headY, 0], [0.5, 0.32, 0.4],
        'deep', b.pitch),
    part('head', 'box', [headX + (gadfly ? 0.12 : 0.06), headY + 0.03, 0],
      [gadfly ? 0.24 : 0.16, 0.14, gadfly ? 0.28 : 0.26], 'glass', b.pitch),
    part('head', 'box', [headX - 0.06, headY + 0.18, 0],
      [gadfly ? 0.48 : 0.3, 0.07, gadfly ? 0.36 : 0.34], 'plate', b.pitch),
  );
  aerials(parts, has, headX - 0.2, headY + 0.14);

  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    parts.push(
      part(location, 'sphere', [0, b.tall * 0.02, side * b.shoulder * 0.9], [0.24, 0.24, 0.24], 'deep'),
      part(location, 'limb',
        [b.long * (gadfly ? 0.04 : 0.12), -b.tall * (gadfly ? 0.04 : 0.16), side * b.shoulder],
        [gadfly ? 0.18 : 0.24, b.tall * (gadfly ? 0.34 : 0.5), gadfly ? 0.15 : 0.2], 'plate'),
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
      head: [b.long * 0.56 - 0.1, b.tall * 0.34 + 0.3, 0],
    },
    crown: b.tall * 0.8,
  };
};

/** The scout is deliberately less machine than mast and legs. */
export const scoutPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) birdLeg(parts, b, side, 0.46);
  hips(parts, b, 0.7);

  parts.push(
    shaped('centre_torso', PROFILES.wedge, [0, 0, 0], [b.long, b.tall, b.wide], 'plate', b.pitch),
    part('centre_torso', 'box', [-b.long * 0.3, b.tall * 0.34, 0],
      [b.long * 0.3, b.tall * 0.34, b.wide * 0.5], 'deep'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    if (fittingFor(fit[location]) === 'bare') continue;
    parts.push(shaped(location, PROFILES.pod,
      [-b.long * 0.04, b.tall * 0.3, side * b.wide * 0.7],
      [b.long * 0.44, b.tall * 0.42, b.wide * 0.3], 'plate', b.pitch));
  }

  const headX = b.long * 0.34;
  const headY = b.tall * 0.4;
  parts.push(
    shaped('head', PROFILES.canopy, [headX, headY, 0], [0.42, 0.32, 0.38], 'deep', b.pitch),
    part('head', 'box', [headX + 0.14, headY + 0.02, 0], [0.12, 0.15, 0.26], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.14);

  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_arm' : 'right_arm';
    parts.push(part(location, 'limb', [b.long * 0.1, -b.tall * 0.1, side * b.shoulder],
      [0.2, b.tall * 0.62, 0.17], 'deep'));
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
