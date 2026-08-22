import {
  boxInstances,
  cylinderInstances,
  weaponCylinder,
  weaponGlowMaterial,
  weaponHousing,
} from './weaponGeometry';
import type { WeaponBuildContext, WeaponBuildParts } from './weaponModelTypes';

export function buildAurelianWeapon(context: WeaponBuildContext): WeaponBuildParts {
  if (context.art.family === 'pulse') return buildPulseEmitter(context);
  if (context.art.family === 'projector') return buildProjector(context);
  return buildBeamEmitter(context);
}

function dimensions(context: WeaponBuildContext): { bore: number; length: number } {
  const refinement = 0.88 + context.art.bulk * 0.12;
  return {
    bore: 0.052 * context.heft * context.scale * refinement,
    length: 0.78 * context.heft * context.scale * context.art.bulk,
  };
}

function buildBeamEmitter(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const glow = weaponGlowMaterial(context.mount.visual);
  const housing = weaponHousing(
    'aurelian-beam-shroud',
    [length * 0.34, bore * 3.4, bore * 3.5],
    [-length * 0.2, 0, 0],
    context.material,
    context.quality,
  );
  const emitter = weaponCylinder(
    'beam-crystal-channel',
    bore * 0.78,
    bore * 0.58,
    length * 0.72,
    [length * 0.2, 0, 0],
    glow,
    context.quality,
  );
  const aperture = weaponCylinder(
    'beam-focusing-aperture',
    bore * 1.28,
    bore * 1.28,
    bore * 0.72,
    [length * 0.59, 0, 0],
    context.boreMaterial,
    context.quality,
  );
  context.root.add(housing, emitter, aperture);

  if (context.art.accent === 'focused' || context.art.accent === 'smelter') {
    const fins = boxInstances(
      'beam-focus-vanes',
      2,
      [length * 0.44, bore * 0.28, bore * 0.72],
      context.material,
      (index) => ({
        x: length * 0.17,
        y: (index === 0 ? -1 : 1) * bore * 1.18,
        z: 0,
      }),
    );
    context.root.add(fins);
  }

  return {
    breechX: -length * 0.4,
    muzzleX: length * 0.65,
    aperture,
    apertureTravel: context.art.accent === 'smelter' ? 0.36 : 0.24,
  };
}

function buildPulseEmitter(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const barrels = Math.max(2, Math.min(4, context.art.barrels));
  const glow = weaponGlowMaterial(context.mount.visual);
  const housing = weaponHousing(
    'aurelian-pulse-breech',
    [length * 0.38, bore * 3.7, bore * 3.9],
    [-length * 0.21, 0, 0],
    context.material,
    context.quality,
  );
  const channels = cylinderInstances(
    'pulse-emitter-bank',
    barrels,
    bore * 0.5,
    length * 0.58,
    glow,
    context.quality,
    (index) => {
      const angle = (index / barrels) * Math.PI * 2;
      return {
        x: length * 0.24,
        y: Math.sin(angle) * bore * 1.02,
        z: Math.cos(angle) * bore * 1.02,
      };
    },
  );
  const aperture = weaponCylinder(
    'pulse-gate',
    bore * 1.58,
    bore * 1.58,
    bore * 0.72,
    [length * 0.57, 0, 0],
    context.boreMaterial,
    context.quality,
  );
  const capacitors = boxInstances(
    'pulse-capacitor-pair',
    2,
    [length * 0.2, bore * 0.7, bore * 0.72],
    context.material,
    (index) => ({ x: -length * 0.19, y: 0, z: (index === 0 ? -1 : 1) * bore * 1.55 }),
  );
  context.root.add(housing, channels, aperture, capacitors);
  return {
    breechX: -length * 0.42,
    muzzleX: length * 0.62,
    feed: channels,
    feedKind: 'spin',
    feedTravel: Math.PI * 0.6,
    aperture,
    apertureTravel: 0.4,
  };
}

function buildProjector(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const glow = weaponGlowMaterial(context.mount.visual);
  const housing = weaponHousing(
    'aurelian-projector-cradle',
    [length * 0.42, bore * 4.1, bore * 4.1],
    [-length * 0.23, 0, 0],
    context.material,
    context.quality,
  );
  const coil = weaponCylinder(
    context.art.accent === 'plasma' ? 'plasma-vessel' : 'arc-coil',
    bore * 1.48,
    bore * 1.48,
    length * 0.46,
    [length * 0.08, 0, 0],
    glow,
    context.quality,
  );
  const prongs = boxInstances(
    'projector-prongs',
    context.art.accent === 'plasma' ? 3 : 2,
    [length * 0.48, bore * 0.55, bore * 0.72],
    context.material,
    (index) => {
      const count = context.art.accent === 'plasma' ? 3 : 2;
      const angle = (index / count) * Math.PI * 2;
      return {
        x: length * 0.35,
        y: Math.sin(angle) * bore * 1.72,
        z: Math.cos(angle) * bore * 1.72,
      };
    },
  );
  const aperture = weaponCylinder(
    'projector-crown',
    bore * 0.8,
    bore * 0.52,
    bore * 0.78,
    [length * 0.61, 0, 0],
    context.boreMaterial,
    context.quality,
  );
  context.root.add(housing, coil, prongs, aperture);
  return {
    breechX: -length * 0.45,
    muzzleX: length * 0.68,
    feed: coil,
    feedTravel: length * 0.025,
    aperture,
    apertureTravel: 0.32,
  };
}
