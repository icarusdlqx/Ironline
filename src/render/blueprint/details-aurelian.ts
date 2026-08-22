import { PROFILES } from './profiles';
import { detailed, part, shaped } from './parts';
import type { BlueprintPart, Bones } from './types';

function surface(piece: BlueprintPart): BlueprintPart {
  return detailed(piece, 'surface');
}

function hero(piece: BlueprintPart): BlueprintPart {
  return detailed(piece, 'hero');
}

function votiveDetails(b: Bones): BlueprintPart[] {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) {
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(
      surface(shaped(arm, PROFILES.wedge,
        [b.long * 0.18, -b.tall * 0.12, side * b.shoulder * 1.03],
        [0.06, b.tall * 0.34, b.wide * 0.09], 'trim', b.pitch)),
      surface(shaped(torso, PROFILES.pauldron,
        [-b.long * 0.1, b.tall * 0.34, side * b.wide * 0.62],
        [b.long * 0.18, 0.07, b.wide * 0.12], 'trim', b.pitch)),
      hero(shaped('head', PROFILES.wedge,
        [b.long * 0.47, b.tall * 0.28, side * b.wide * 0.2],
        [0.06, b.tall * 0.1, b.wide * 0.07], 'accent', b.pitch)),
      hero(shaped(arm, PROFILES.wedge,
        [b.long * 0.23, -b.tall * 0.38, side * b.shoulder],
        [b.long * 0.18, 0.06, b.wide * 0.32], 'accent', b.pitch)),
      hero(shaped(torso, PROFILES.keel,
        [b.long * 0.34, b.tall * 0.02, side * b.wide * 0.34],
        [0.05, b.tall * 0.34, b.wide * 0.1], 'plate', b.pitch)),
    );
  }
  return parts;
}

function sentinelDetails(b: Bones): BlueprintPart[] {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) {
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(
      surface(shaped(torso, PROFILES.pauldron,
        [b.long * 0.18, b.tall * 0.3, side * b.wide * 0.64],
        [b.long * 0.2, b.tall * 0.1, b.wide * 0.1], 'trim', b.pitch)),
      surface(part(arm, 'box',
        [b.long * 0.25, -b.tall * 0.22, side * b.shoulder * 1.02],
        [0.06, b.tall * 0.3, b.wide * 0.08], 'trim', b.pitch)),
      hero(shaped(torso, PROFILES.keel,
        [b.long * 0.44, 0, side * b.wide * 0.25],
        [0.05, b.tall * 0.28, b.wide * 0.11], 'accent', b.pitch)),
      hero(part('head', 'box',
        [b.long * 0.4, b.tall * 0.54, side * b.wide * 0.19],
        [0.055, b.tall * 0.12, b.wide * 0.06], 'glass')),
      hero(shaped(arm, PROFILES.shield,
        [b.long * 0.12, -b.tall * 0.5, side * b.shoulder * 1.02],
        [b.long * 0.2, 0.055, b.wide * 0.28], 'plate', b.pitch)),
    );
  }
  return parts;
}

function halberdDetails(b: Bones): BlueprintPart[] {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) {
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(
      surface(shaped(torso, PROFILES.keel,
        [b.long * 0.22, b.tall * 0.62, side * b.wide * 0.75],
        [0.06, b.tall * 0.68, b.wide * 0.1], 'trim', b.pitch)),
      surface(part(torso, 'box',
        [-b.long * 0.22, b.tall * 0.7, side * b.wide * 0.76],
        [b.long * 0.24, 0.055, b.wide * 0.12], 'accent', b.pitch)),
      hero(shaped(arm, PROFILES.wedge,
        [b.long * 0.29, -b.tall * 0.16, side * b.shoulder],
        [b.long * 0.12, b.tall * 0.2, b.wide * 0.32], 'accent', b.pitch)),
      hero(shaped(torso, PROFILES.wedge,
        [b.long * 0.04, b.tall * 0.25, side * b.wide * 0.44],
        [b.long * 0.36, 0.055, b.wide * 0.11], 'plate', b.pitch)),
      hero(part('head', 'box',
        [b.long * 0.47, b.tall * 0.26, side * b.wide * 0.17],
        [0.05, b.tall * 0.09, b.wide * 0.07], 'glass')),
    );
  }
  return parts;
}

function pallvaultDetails(b: Bones): BlueprintPart[] {
  const parts: BlueprintPart[] = [];
  for (const side of [-1, 1]) {
    const arm = side < 0 ? 'left_arm' : 'right_arm';
    const torso = side < 0 ? 'left_torso' : 'right_torso';
    parts.push(
      surface(part(torso, 'box',
        [b.long * 0.34, b.tall * 0.15, side * b.wide * 0.64],
        [0.055, b.tall * 0.2, b.wide * 0.26], 'accent', b.pitch)),
      surface(part(arm, 'box',
        [b.long * 0.3, -b.tall * 0.34, side * b.shoulder],
        [0.055, b.tall * 0.24, b.wide * 0.26], 'accent', b.pitch)),
      hero(shaped(torso, PROFILES.wedge,
        [-b.long * 0.24, b.tall * 0.08, side * b.wide * 0.66],
        [b.long * 0.18, b.tall * 0.3, b.wide * 0.1], 'trim', b.pitch)),
      hero(shaped(torso, PROFILES.wedge,
        [b.long * 0.31, b.tall * 0.15, side * b.wide * 0.53],
        [0.06, b.tall * 0.12, b.wide * 0.09], 'glass', b.pitch)),
      hero(shaped(arm, PROFILES.wedge,
        [b.long * 0.27, -b.tall * 0.34, side * b.shoulder * 0.92],
        [0.06, b.tall * 0.16, b.wide * 0.09], 'glass', b.pitch)),
      hero(shaped('head', PROFILES.wedge,
        [b.long * 0.45, b.tall * 0.32, side * b.wide * 0.22],
        [0.055, b.tall * 0.1, b.wide * 0.08], 'plate')),
    );
  }
  return parts;
}

export function aurelianSignatureDetails(identity: string, b: Bones): BlueprintPart[] | null {
  if (identity === 'votive_vtv2') return votiveDetails(b);
  if (identity === 'sentinel_snl2') return sentinelDetails(b);
  if (identity === 'halberd_hlb4') return halberdDetails(b);
  if (identity === 'pallvault_plv1') return pallvaultDetails(b);
  return null;
}
