import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { Weapon } from '../schema/weapon';
import {
  CURRENT_WEAPON_IDS,
  hasAuthoredWeaponArt,
  WEAPON_ART,
  weaponArtFor,
} from './weaponArt';
import type { MountArt } from './weaponModelTypes';

function mount(weapon: Weapon): MountArt {
  return {
    weaponId: weapon.id,
    location: 'left_arm',
    type: weapon.type,
    tonnage: weapon.tonnage,
    projectiles: weapon.projectiles,
    recoil: weapon.recoil,
    visual: weapon.visual,
  };
}

describe('weapon art registry', () => {
  it('is exact and exhaustive for the 24 current catalogue ids', () => {
    const catalogueIds = [...catalog.weapons.keys()].sort();
    expect(CURRENT_WEAPON_IDS).toHaveLength(24);
    expect([...CURRENT_WEAPON_IDS].sort()).toEqual(catalogueIds);
    expect(Object.keys(WEAPON_ART).sort()).toEqual(catalogueIds);
    for (const weapon of catalog.weapons.values()) {
      expect(hasAuthoredWeaponArt(weapon.id), weapon.id).toBe(true);
      const resolved = weaponArtFor(mount(weapon));
      expect(resolved.authored, weapon.id).toBe(true);
      expect(resolved.nativeFaction, weapon.id).toBe(weapon.faction);
    }
  });

  it('covers eleven visibly separate active construction families', () => {
    const families = new Set(
      [...catalog.weapons.values()].map((weapon) => weaponArtFor(mount(weapon)).family),
    );
    expect([...families].sort()).toEqual([
      'beam',
      'cannon',
      'flame',
      'missile-flat',
      'missile-loft',
      'missile-seeker',
      'projector',
      'pulse',
      'rail',
      'rotary-cannon',
      'scatter-cannon',
    ]);
  });

  it('falls back safely for stale saved ids without claiming authored art', () => {
    const stale = (weaponId: string, type: MountArt['type'], projectiles = 1): MountArt => ({
      weaponId,
      location: 'left_arm',
      type,
      tonnage: 5,
      projectiles,
      recoil: 0.1,
      visual: {
        style: type === 'missile' ? 'missile' : type === 'energy' ? 'beam' : 'tracer',
        colour: '#ffffff',
        width: 2,
        arc: 0,
      },
    });

    expect(weaponArtFor(stale('ultra_ac5', 'ballistic'))).toMatchObject({
      authored: false,
      family: 'rapid-cannon',
      nativeFaction: 'linewrought',
    });
    expect(weaponArtFor(stale('thunderbolt_5', 'missile'))).toMatchObject({
      authored: false,
      family: 'missile-heavy',
      nativeFaction: 'linewrought',
    });
    expect(weaponArtFor(stale('salvaged_laser', 'energy'))).toMatchObject({
      authored: false,
      family: 'beam',
      nativeFaction: 'aurelian',
    });
  });
});
