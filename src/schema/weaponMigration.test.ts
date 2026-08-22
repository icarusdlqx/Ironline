import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import {
  canonicalWeaponId,
  migrateDesignWeaponIds,
  WEAPON_ID_ALIASES,
} from './weaponMigration';

describe('weapon id migration', () => {
  it('has one live catalogue target for every retired id', () => {
    expect(Object.keys(WEAPON_ID_ALIASES)).toHaveLength(17);
    for (const [retired, retained] of Object.entries(WEAPON_ID_ALIASES)) {
      expect(retained, `${retired} has no retained replacement`).not.toBe(retired);
      expect(catalog.weapons.has(retained), `${retired} points at missing ${retained}`).toBe(true);
    }
  });

  it('rewrites mounts and ammunition exactly once', () => {
    const retired = Object.keys(WEAPON_ID_ALIASES);
    const raw = {
      mounts: retired.map((weaponId) => ({ weaponId, location: 'left_arm' })),
      ammo: retired.map((weaponId) => ({ weaponId, location: 'left_torso', tons: 1 })),
      equipment: [{ equipmentId: 'case', location: 'left_torso' }],
    };

    const migrated = migrateDesignWeaponIds(raw) as typeof raw;
    expect(migrated.mounts.map((mount) => mount.weaponId)).toEqual(
      retired.map(canonicalWeaponId),
    );
    expect(migrated.ammo.map((load) => load.weaponId)).toEqual(
      retired.map(canonicalWeaponId),
    );
    expect(migrated.equipment).toEqual(raw.equipment);
    expect(migrateDesignWeaponIds(migrated)).toEqual(migrated);
  });

  it('leaves unrecognised ids and malformed fields for normal validation', () => {
    const raw = {
      mounts: [{ weaponId: 'future_weapon', location: 'right_arm' }, 'broken'],
      ammo: null,
    };
    expect(migrateDesignWeaponIds(raw)).toEqual(raw);
  });
});
