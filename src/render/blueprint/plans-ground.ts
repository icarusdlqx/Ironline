import { PROFILES } from './profiles';
import {
  aerials,
  bolted,
  fittingFor,
  part,
  radiators,
  shaped,
  shoulderMount,
} from './parts';
import type { Blueprint, BlueprintPart, Bones, HardpointMap, Plan } from './types';

function trackUnit(parts: BlueprintPart[], b: Bones, side: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const height = b.hip * 0.9;

  parts.push(
    shaped(location, PROFILES.skirt, [0, height * 0.66, z],
      [b.long * 1.2, height * 0.5, b.thigh * 1.4], 'plate'),
    part(location, 'box', [0, height * 0.34, z],
      [b.long * 1.24, height * 0.52, b.thigh * 1.2], 'deep'),
  );
  for (const along of [-0.38, -0.13, 0.13, 0.38]) {
    parts.push(part(location, 'cylinder', [b.long * along, height * 0.24, z],
      [height * 0.34, b.thigh * 1.3, height * 0.34], 'accent', Math.PI / 2));
  }
  for (const end of [-0.56, 0.56]) {
    parts.push(part(location, 'cylinder', [b.long * end, height * 0.4, z],
      [height * 0.44, b.thigh * 1.24, height * 0.44], 'trim', Math.PI / 2));
  }
}

function wheelUnit(parts: BlueprintPart[], b: Bones, side: number): void {
  const z = side * b.spread;
  const location = side < 0 ? 'left_leg' : 'right_leg';
  const radius = b.hip * 0.46;

  parts.push(part(location, 'box', [0, b.hip * 0.74, z],
    [b.long * 1.1, b.hip * 0.3, b.thigh], 'deep'));
  for (const along of [-0.44, 0, 0.44]) {
    parts.push(
      part(location, 'cylinder', [b.long * along, radius, z],
        [radius * 2, b.thigh * 1.1, radius * 2], 'deep', Math.PI / 2),
      part(location, 'cylinder', [b.long * along, radius, z * 1.05],
        [radius, b.thigh * 1.2, radius], 'accent', Math.PI / 2),
    );
  }
}

/** The hull stays put while everything above the ring traverses. */
function vehicleBody(
  parts: BlueprintPart[],
  b: Bones,
  has: (trait: string) => boolean,
  fit: HardpointMap,
): void {
  const deck = b.hip * 0.92;
  parts.push(
    bolted(shaped('centre_torso', PROFILES.hull, [0, deck + b.tall * 0.16, 0],
      [b.long * 1.5, b.tall * 0.56, b.wide * 1.5], 'plate')),
    bolted(part('centre_torso', 'cylinder', [0, deck + b.tall * 0.46, 0],
      [b.wide * 0.92, b.tall * 0.12, b.wide * 0.92], 'deep')),
    shaped('centre_torso', PROFILES.wedge, [0, deck + b.tall * 0.72, 0],
      [b.long * 0.94, b.tall * 0.46, b.wide * 0.96], 'plate'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block,
      [-b.long * 0.08, deck + b.tall * 0.7, side * b.wide * 0.54],
      [b.long * 0.72, b.tall * 0.4, b.wide * 0.24], 'deep'));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 1, 0.9, 0.4);
  }

  const headX = -b.long * 0.18;
  const headY = deck + b.tall * 1.04;
  parts.push(
    part('head', 'cylinder', [headX, headY, b.wide * 0.26], [0.34, 0.24, 0.34], 'deep'),
    part('head', 'box', [headX + 0.16, headY + 0.02, b.wide * 0.26],
      [0.1, 0.12, 0.26], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.12);
}

function vehicleHardpoints(b: Bones): Blueprint['hardpoints'] {
  const deck = b.hip * 0.92;
  return {
    left_torso: [b.long * 0.2, deck + b.tall * 0.76, -b.wide * 0.64],
    right_torso: [b.long * 0.2, deck + b.tall * 0.76, b.wide * 0.64],
    centre_torso: [b.long * 0.48, deck + b.tall * 0.72, 0],
    head: [-b.long * 0.18, deck + b.tall * 1.2, b.wide * 0.26],
    left_arm: [0, deck, -b.wide * 0.72],
    right_arm: [0, deck, b.wide * 0.72],
  };
}

export const trackedPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) trackUnit(parts, b, side);
  vehicleBody(parts, b, has, fit);
  if (has('oversized_sinks')) radiators(parts, b);
  return { parts, hardpoints: vehicleHardpoints(b), crown: b.tall * 1.5 };
};

export const wheeledPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) wheelUnit(parts, b, side);
  vehicleBody(parts, b, has, fit);
  return { parts, hardpoints: vehicleHardpoints(b), crown: b.tall * 1.5 };
};

/** An emplacement spends the silhouette an engine would occupy on a mantlet. */
export const emplacementPlan: Plan = (b, has, fit) => {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) {
    parts.push(part(side < 0 ? 'left_leg' : 'right_leg', 'box',
      [0, b.hip * 0.16, side * b.spread * 0.9],
      [b.long * 1.6, b.hip * 0.32, b.wide * 0.86], 'deep'));
  }
  parts.push(bolted(part(null, 'cylinder', [0, b.hip * 0.46, 0],
    [b.wide * 1.5, b.hip * 0.28, b.wide * 1.5], 'trim')));
  parts.push(
    shaped('centre_torso', PROFILES.wedge, [0, b.tall * 0.08, 0],
      [b.long * 1.2, b.tall * 0.9, b.wide * 1.2], 'plate'),
    shaped('centre_torso', PROFILES.pauldron, [b.long * 0.56, 0, 0],
      [0.34, b.tall * 1.06, b.wide * 1.1], 'trim'),
  );
  for (const side of [-1, 1]) {
    const location = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(shaped(location, PROFILES.block,
      [-b.long * 0.1, b.tall * 0.06, side * b.wide * 0.68],
      [b.long * 0.9, b.tall * 0.74, b.wide * 0.34], 'deep'));
    shoulderMount(parts, b, side, fittingFor(fit[location]), 1, 1, 0.2);
  }
  const headX = -b.long * 0.3;
  const headY = b.tall * 0.6;
  parts.push(
    part('head', 'box', [headX, headY, 0], [0.4, 0.28, 0.5], 'deep'),
    part('head', 'box', [headX + 0.2, headY, 0], [0.1, 0.14, 0.34], 'glass'),
  );
  aerials(parts, has, headX, headY + 0.14);

  return {
    parts,
    hardpoints: {
      left_torso: [b.long * 0.3, b.tall * 0.1, -b.wide * 0.8],
      right_torso: [b.long * 0.3, b.tall * 0.1, b.wide * 0.8],
      centre_torso: [b.long * 0.62, b.tall * 0.02, 0],
      head: [headX, headY + 0.2, 0],
      left_arm: [0, 0, -b.wide * 0.92],
      right_arm: [0, 0, b.wide * 0.92],
    },
    crown: b.tall * 0.9,
  };
};
