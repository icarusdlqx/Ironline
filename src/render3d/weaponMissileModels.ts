import {
  boxInstances,
  cylinderInstances,
  weaponBox,
  weaponCylinder,
  weaponGlowMaterial,
  weaponHousing,
} from './weaponGeometry';
import type { WeaponBuildContext, WeaponBuildParts } from './weaponModelTypes';

export function buildMissileWeapon(context: WeaponBuildContext): WeaponBuildParts {
  const family = context.art.family;
  const count = Math.max(1, Math.min(40, context.art.ports));
  const { columns, rows } = rackGrid(family, count);
  const cell = (family === 'missile-heavy' ? 0.28 : 0.15) * context.scale;
  const height = Math.max(0.3 * context.scale, rows * cell);
  const width = Math.max(0.3 * context.scale, columns * cell);
  const depthFactor = family === 'missile-loft' ? 0.5 : family === 'missile-heavy' ? 0.58 : 0.36;
  const depth = depthFactor * context.heft * context.scale * context.art.bulk;
  const housing = weaponHousing(
    `line-${family}-rack`,
    [depth, height, width],
    [0, 0, 0],
    context.material,
    context.quality,
  );
  const bore = Math.min(height / rows, width / columns) * (family === 'missile-heavy' ? 0.38 : 0.29);
  const pitch = family === 'missile-loft' ? -0.11 : 0;
  const tubes = cylinderInstances(
    'missile-tubes',
    count,
    bore,
    0.09 * context.scale,
    context.boreMaterial,
    context.quality,
    (index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      return {
        x: depth * 0.54,
        y: rows === 1 ? 0 : (row / (rows - 1) - 0.5) * height * 0.7,
        z: columns === 1 ? 0 : (column / (columns - 1) - 0.5) * width * 0.7,
        pitch,
      };
    },
  );
  context.root.add(housing, tubes);
  const aperture = familyDetail(context, depth, height, width, bore);
  context.root.add(aperture);
  return {
    breechX: -depth * 0.56,
    muzzleX: Math.max(depth * 0.64, depth * 0.54 + 0.045 * context.scale),
    aperture,
    apertureTravel: family === 'missile-seeker' ? 0.16 : 0.38,
  };
}

function rackGrid(
  family: WeaponBuildContext['art']['family'],
  count: number,
): { columns: number; rows: number } {
  if (family === 'missile-heavy') return { columns: 1, rows: 1 };
  if (family === 'missile-loft') {
    const columns = Math.min(5, count);
    return { columns, rows: Math.ceil(count / columns) };
  }
  if (family === 'missile-flat' && count >= 12) {
    const columns = Math.ceil(count / 2);
    return { columns, rows: 2 };
  }
  const columns = Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
}

function familyDetail(
  context: WeaponBuildContext,
  depth: number,
  height: number,
  width: number,
  bore: number,
) {
  if (context.art.family === 'missile-loft') {
    return weaponBox(
      'longshot-blast-hood',
      [depth * 0.32, height * 0.13, width * 1.06],
      [depth * 0.28, height * 0.55, 0],
      context.boreMaterial,
    );
  }
  if (context.art.family === 'missile-seeker') {
    return weaponCylinder(
      'seeker-tracking-eye',
      bore * 1.5,
      bore * 1.12,
      depth * 0.18,
      [depth * 0.48, height * 0.35, 0],
      weaponGlowMaterial(context.mount.visual),
      context.quality,
    );
  }
  if (context.art.family === 'missile-heavy') {
    return weaponCylinder(
      'heavy-missile-collar',
      bore * 1.45,
      bore * 1.45,
      depth * 0.14,
      [depth * 0.53, 0, 0],
      context.boreMaterial,
      context.quality,
    );
  }
  return boxInstances(
    context.art.accent === 'volley' ? 'volley-side-rails' : 'shortbow-side-rails',
    2,
    [depth * 0.7, height * 0.09, bore * 0.62],
    context.boreMaterial,
    (index) => ({ x: 0, y: (index === 0 ? -1 : 1) * height * 0.53, z: 0 }),
  );
}
