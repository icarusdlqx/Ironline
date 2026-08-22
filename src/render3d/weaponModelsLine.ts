import {
  boxInstances,
  cylinderInstances,
  weaponBox,
  weaponCylinder,
  weaponGlowMaterial,
  weaponHousing,
} from './weaponGeometry';
import type { WeaponBuildContext, WeaponBuildParts } from './weaponModelTypes';

export function buildLineWeapon(context: WeaponBuildContext): WeaponBuildParts {
  if (context.art.family === 'flame') return buildFlamer(context);
  if (context.art.family === 'rail') return buildRail(context);
  if (context.art.family === 'scatter-cannon') return buildScatterCannon(context);
  if (context.art.family === 'rotary-cannon' || context.art.family === 'rapid-cannon') {
    return buildRotaryCannon(context);
  }
  return buildCannon(context);
}

function dimensions(context: WeaponBuildContext): { bore: number; length: number } {
  return {
    bore: 0.08 * context.heft * context.scale * (0.9 + context.art.bulk * 0.1),
    length: 0.88 * context.heft * context.scale * context.art.bulk,
  };
}

function lineHousing(context: WeaponBuildContext, length: number, bore: number, name: string) {
  return weaponHousing(
    name,
    [length * 0.44, bore * 3.8, bore * 4.1],
    [-length * 0.24, 0, 0],
    context.material,
    context.quality,
  );
}

function buildCannon(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const housing = lineHousing(context, length, bore, context.art.accent === 'siege'
    ? 'line-siege-receiver'
    : 'line-field-receiver');
  const barrel = weaponCylinder(
    context.art.accent === 'siege' ? 'siege-barrel' : 'field-barrel',
    bore,
    bore * 0.76,
    length * 0.72,
    [length * 0.22, 0, 0],
    context.material,
    context.quality,
  );
  const aperture = weaponCylinder(
    context.art.accent === 'siege' ? 'siege-baffle-brake' : 'field-muzzle-collar',
    bore * (context.art.accent === 'siege' ? 1.65 : 1.28),
    bore * (context.art.accent === 'siege' ? 1.42 : 1.28),
    bore * (context.art.accent === 'siege' ? 1.5 : 0.78),
    [length * 0.62, 0, 0],
    context.boreMaterial,
    context.quality,
  );
  const feed = weaponBox(
    'line-ammunition-feed',
    [length * 0.2, bore * 1.45, bore * 2.1],
    [-length * 0.25, -bore * 2.15, 0],
    context.boreMaterial,
  );
  context.root.add(housing, barrel, aperture, feed);
  return {
    breechX: -length * 0.46,
    muzzleX: length * 0.7,
    feed,
    feedTravel: length * 0.04,
    aperture,
    apertureTravel: 0.12,
  };
}

function buildRotaryCannon(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const barrels = Math.max(2, Math.min(4, context.art.barrels));
  const housing = lineHousing(context, length, bore, 'line-rotary-receiver');
  const cluster = cylinderInstances(
    'rotary-barrel-pack',
    barrels,
    bore * 0.46,
    length * 0.68,
    context.material,
    context.quality,
    (index) => {
      const angle = (index / barrels) * Math.PI * 2;
      return {
        x: length * 0.24,
        y: Math.sin(angle) * bore * 0.92,
        z: Math.cos(angle) * bore * 0.92,
      };
    },
  );
  const aperture = weaponCylinder(
    'rotary-barrel-clamp',
    bore * 1.6,
    bore * 1.6,
    bore * 0.8,
    [length * 0.61, 0, 0],
    context.boreMaterial,
    context.quality,
  );
  const feed = weaponBox(
    'rotary-feed-box',
    [length * 0.17, bore * 1.7, bore * 2.2],
    [-length * 0.24, -bore * 2.2, 0],
    context.boreMaterial,
  );
  context.root.add(housing, cluster, aperture, feed);
  return {
    breechX: -length * 0.45,
    muzzleX: length * 0.68,
    feed: cluster,
    feedKind: 'spin',
    feedTravel: Math.PI * 2,
    aperture,
    apertureTravel: 0.18,
  };
}

function buildScatterCannon(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const ports = Math.max(3, Math.min(6, context.art.barrels));
  const housing = lineHousing(context, length, bore, 'line-canister-receiver');
  const barrel = weaponCylinder(
    'canister-sleeve',
    bore * 1.34,
    bore * 1.12,
    length * 0.7,
    [length * 0.22, 0, 0],
    context.material,
    context.quality,
  );
  const muzzles = cylinderInstances(
    'canister-muzzle-cluster',
    ports,
    bore * 0.27,
    bore * 0.72,
    context.boreMaterial,
    context.quality,
    (index) => {
      const angle = (index / ports) * Math.PI * 2;
      return {
        x: length * 0.61,
        y: Math.sin(angle) * bore * 0.7,
        z: Math.cos(angle) * bore * 0.7,
      };
    },
  );
  const feed = weaponBox(
    'canister-drum',
    [length * 0.17, bore * 2.4, bore * 2.4],
    [-length * 0.23, -bore * 2.25, 0],
    context.boreMaterial,
  );
  context.root.add(housing, barrel, muzzles, feed);
  return {
    breechX: -length * 0.46,
    muzzleX: length * 0.7,
    feed,
    feedTravel: length * 0.04,
    aperture: muzzles,
    apertureTravel: 0.12,
  };
}

function buildRail(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const glow = weaponGlowMaterial(context.mount.visual);
  const housing = lineHousing(context, length, bore, 'line-rail-breech');
  const rails = boxInstances(
    'gauss-twin-rails',
    2,
    [length * 0.78, bore * 0.52, bore * 0.72],
    context.material,
    (index) => ({ x: length * 0.24, y: 0, z: (index === 0 ? -1 : 1) * bore * 1.28 }),
  );
  const core = weaponCylinder(
    'gauss-accelerator-core',
    bore * 0.34,
    bore * 0.34,
    length * 0.74,
    [length * 0.25, 0, 0],
    glow,
    context.quality,
  );
  const feed = weaponBox(
    'gauss-capacitor-block',
    [length * 0.2, bore * 2.6, bore * 2.8],
    [-length * 0.28, -bore * 2.3, 0],
    context.boreMaterial,
  );
  context.root.add(housing, rails, core, feed);
  return {
    breechX: -length * 0.5,
    muzzleX: length * 0.69,
    feed,
    feedTravel: length * 0.025,
    aperture: core,
    apertureTravel: 0.08,
  };
}

function buildFlamer(context: WeaponBuildContext): WeaponBuildParts {
  const { bore, length } = dimensions(context);
  const housing = lineHousing(context, length, bore, 'line-flamer-pump');
  const nozzle = weaponCylinder(
    'flamer-bell',
    bore * 1.62,
    bore * 0.72,
    length * 0.56,
    [length * 0.23, 0, 0],
    context.boreMaterial,
    context.quality,
  );
  const aperture = weaponCylinder(
    'flamer-igniter-ring',
    bore * 1.86,
    bore * 1.86,
    bore * 0.72,
    [length * 0.55, 0, 0],
    context.material,
    context.quality,
  );
  const feed = weaponBox(
    'flamer-pressure-bottle',
    [length * 0.24, bore * 1.6, bore * 1.8],
    [-length * 0.24, -bore * 2.05, 0],
    context.boreMaterial,
  );
  context.root.add(housing, nozzle, aperture, feed);
  return {
    breechX: -length * 0.45,
    muzzleX: length * 0.62,
    feed,
    feedTravel: length * 0.03,
    aperture,
    apertureTravel: 0.28,
  };
}
