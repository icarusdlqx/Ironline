import type { MountArt, ResolvedWeaponArt, WeaponArtSpec, WeaponModelFamily } from './weaponModelTypes';

export const CURRENT_WEAPON_IDS = [
  'ac20',
  'ac5',
  'er_large_laser',
  'er_medium_laser',
  'er_ppc',
  'flamer',
  'gauss_rifle',
  'heavy_large_laser',
  'large_laser',
  'large_pulse_laser',
  'lbx_ac10',
  'lrm10',
  'lrm20',
  'machine_gun',
  'medium_laser',
  'medium_pulse_laser',
  'mrm20',
  'plasma_rifle',
  'ppc',
  'small_laser',
  'small_pulse_laser',
  'srm2',
  'srm6',
  'streak_srm6',
] as const;

export type CurrentWeaponId = (typeof CURRENT_WEAPON_IDS)[number];

/** IDs are the render contract: prose and balance numbers are free to move around them. */
export const WEAPON_ART = Object.freeze({
  ac20: art('cannon', 'linewrought', 'siege', 1.28),
  ac5: art('cannon', 'linewrought', 'field', 0.94),
  er_large_laser: art('beam', 'aurelian', 'focused', 1.15),
  er_medium_laser: art('beam', 'aurelian', 'focused', 0.92),
  er_ppc: art('projector', 'aurelian', 'focused', 1.2, 2),
  flamer: art('flame', 'linewrought', 'flame', 0.82),
  gauss_rifle: art('rail', 'linewrought', 'rail', 1.25, 2),
  heavy_large_laser: art('beam', 'aurelian', 'smelter', 1.34),
  large_laser: art('beam', 'aurelian', 'standard', 1.12),
  large_pulse_laser: art('pulse', 'aurelian', 'burst', 1.14, 4),
  lbx_ac10: art('scatter-cannon', 'linewrought', 'scatter', 1.16, 4),
  lrm10: art('missile-loft', 'linewrought', 'longshot', 0.94, 1, 10),
  lrm20: art('missile-loft', 'linewrought', 'longshot', 1.2, 1, 20),
  machine_gun: art('rotary-cannon', 'linewrought', 'rotary', 0.62, 3),
  medium_laser: art('beam', 'aurelian', 'standard', 0.9),
  medium_pulse_laser: art('pulse', 'aurelian', 'burst', 0.9, 3),
  mrm20: art('missile-flat', 'linewrought', 'volley', 1.16, 1, 20),
  plasma_rifle: art('projector', 'aurelian', 'plasma', 1.08, 3),
  ppc: art('projector', 'aurelian', 'arc', 1, 2),
  small_laser: art('beam', 'aurelian', 'compact', 0.7),
  small_pulse_laser: art('pulse', 'aurelian', 'burst', 0.68, 2),
  srm2: art('missile-flat', 'linewrought', 'shortbow', 0.7, 1, 2),
  srm6: art('missile-flat', 'linewrought', 'shortbow', 0.9, 1, 6),
  streak_srm6: art('missile-seeker', 'linewrought', 'seeker', 0.94, 1, 6),
} satisfies Record<CurrentWeaponId, WeaponArtSpec>);

function art(
  family: WeaponModelFamily,
  nativeFaction: WeaponArtSpec['nativeFaction'],
  accent: WeaponArtSpec['accent'],
  bulk: number,
  barrels = 1,
  ports = 1,
): WeaponArtSpec {
  return { family, nativeFaction, accent, bulk, barrels, ports };
}

export function hasAuthoredWeaponArt(weaponId: string): weaponId is CurrentWeaponId {
  return Object.hasOwn(WEAPON_ART, weaponId);
}

export function weaponArtFor(
  mount: Pick<MountArt, 'weaponId' | 'type' | 'projectiles' | 'visual'> &
    Partial<Pick<MountArt, 'tonnage'>>,
): ResolvedWeaponArt {
  if (hasAuthoredWeaponArt(mount.weaponId)) {
    return { ...WEAPON_ART[mount.weaponId], authored: true };
  }
  const family = fallbackFamily(mount);
  const nativeFaction = mount.type === 'energy' && family !== 'flame' ? 'aurelian' : 'linewrought';
  return {
    family,
    nativeFaction,
    accent: fallbackAccent(family),
    bulk: Math.max(0.68, Math.min(1.3, 0.72 + (mount.tonnage ?? 1) / 24)),
    barrels: family === 'rotary-cannon' ? 3 : family === 'rapid-cannon' ? 2 : 1,
    ports: Math.max(1, Math.min(40, mount.projectiles)),
    authored: false,
  };
}

function fallbackFamily(
  mount: Pick<MountArt, 'weaponId' | 'type' | 'projectiles' | 'visual'>,
): WeaponModelFamily {
  if (mount.type === 'energy') {
    if (mount.visual.style === 'pulse' || mount.weaponId.includes('pulse')) return 'pulse';
    if (mount.visual.style === 'flame' || mount.weaponId.includes('flamer')) return 'flame';
    if (mount.visual.style === 'bolt' || mount.weaponId.includes('projector')) return 'projector';
    return 'beam';
  }
  if (mount.type === 'ballistic') {
    if (mount.visual.style === 'slug' || mount.weaponId.includes('gauss')) return 'rail';
    if (mount.weaponId.startsWith('rotary_') || mount.weaponId.includes('machine_gun')) {
      return 'rotary-cannon';
    }
    if (mount.weaponId.startsWith('ultra_')) return 'rapid-cannon';
    if (mount.weaponId.startsWith('lbx_')) return 'scatter-cannon';
    return 'cannon';
  }
  if (mount.projectiles === 1 || mount.weaponId.startsWith('thunderbolt')) return 'missile-heavy';
  if (mount.weaponId.startsWith('streak_') || mount.weaponId.includes('seeker')) {
    return 'missile-seeker';
  }
  if (mount.visual.arc >= 30 || mount.weaponId.startsWith('lrm')) return 'missile-loft';
  return 'missile-flat';
}

function fallbackAccent(family: WeaponModelFamily): WeaponArtSpec['accent'] {
  if (family === 'pulse') return 'burst';
  if (family === 'projector') return 'arc';
  if (family === 'flame') return 'flame';
  if (family === 'rotary-cannon' || family === 'rapid-cannon') return 'rotary';
  if (family === 'scatter-cannon') return 'scatter';
  if (family === 'rail') return 'rail';
  if (family === 'missile-loft') return 'longshot';
  if (family === 'missile-seeker') return 'seeker';
  if (family === 'missile-flat' || family === 'missile-heavy') return 'shortbow';
  return 'standard';
}
