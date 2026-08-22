import { describe, expect, it } from 'vitest';
import type { Design } from '../../schema/design';
import { catalog } from '../../../tests/support';
import {
  ammoShelfWeapons,
  compatibleLocations,
  equipmentFitsChassis,
  equipmentShelfItems,
  remainingInventory,
  weaponFitAtLocation,
} from './bayFit';

function design(id = 'sentinel_brawler'): Design {
  const found = catalog.designs.get(id);
  if (found === undefined) throw new Error(`missing design ${id}`);
  return structuredClone(found);
}

function reasonCodes(
  result: ReturnType<typeof weaponFitAtLocation>,
): string[] {
  return result.reasons.map((reason) => reason.code);
}

describe('bay inventory', () => {
  it('keeps standalone shelves unlimited', () => {
    const draft = design();

    expect(remainingInventory(undefined, draft)).toBeUndefined();
    expect(weaponFitAtLocation(catalog, draft, 'right_torso', 'medium_laser').ok).toBe(true);
  });

  it('subtracts the current campaign draft without charging ammo as another gun', () => {
    const draft = design();
    const remaining = remainingInventory(
      new Map([
        ['ac5', 2],
        ['medium_laser', 4],
        ['srm6', 1],
        ['case', 2],
        ['heat_sink', 12],
        ['double_heat_sink', 10],
      ]),
      draft,
    );

    expect(remaining?.get('ac5')).toBe(1);
    expect(remaining?.get('medium_laser')).toBe(1);
    expect(remaining?.get('srm6')).toBe(0);
    expect(remaining?.get('case')).toBe(1);
    expect(remaining?.get('heat_sink')).toBe(2);
    expect(remaining?.get('double_heat_sink')).toBe(10);
  });

  it('uses same-chassis draft counts to prevent fitting one stored gun twice', () => {
    const draft = design();
    const inventory = new Map([['medium_laser', 4]]);
    const first = weaponFitAtLocation(
      catalog,
      draft,
      'right_torso',
      'medium_laser',
      inventory,
    );
    expect(first.ok).toBe(true);
    expect(first.stockLeft).toBe(1);

    draft.mounts.push({ weaponId: 'medium_laser', location: 'right_torso' });
    const second = weaponFitAtLocation(
      catalog,
      draft,
      'right_torso',
      'medium_laser',
      inventory,
    );

    expect(reasonCodes(second)).toEqual(['stock']);
    expect(second.stockLeft).toBe(0);
  });
});

describe('selected-location weapon fit', () => {
  it('reports a full hardpoint, an oversized weapon, and the wrong type separately', () => {
    const draft = design();

    expect(reasonCodes(weaponFitAtLocation(catalog, draft, 'left_arm', 'medium_laser'))).toEqual([
      'hardpoint_type',
    ]);
    expect(
      reasonCodes(weaponFitAtLocation(catalog, draft, 'right_torso', 'heavy_large_laser')),
    ).toEqual(['hardpoint_size']);
    expect(reasonCodes(weaponFitAtLocation(catalog, draft, 'left_arm', 'machine_gun'))).toEqual([
      'hardpoint_type',
    ]);
  });

  it('reports local slot exhaustion without using global tonnage as a filter', () => {
    const draft = design();
    draft.equipment.push(
      ...Array.from({ length: 4 }, () => ({
        equipmentId: 'case',
        location: 'right_torso' as const,
      })),
    );

    const result = weaponFitAtLocation(catalog, draft, 'right_torso', 'medium_laser');

    expect(reasonCodes(result)).toEqual(['location_slots']);
    expect(result.freeSlots).toBe(0);
    expect(result.reasons[0]?.message).toBe(
      'Medium Laser needs 1 slot; Right Torso has 0 slots free.',
    );
  });

  it('reserves a local slot for the ammunition added with an ammo-fed weapon', () => {
    const draft = design();
    draft.equipment.push(
      ...Array.from({ length: 3 }, () => ({
        equipmentId: 'case',
        location: 'right_torso' as const,
      })),
    );

    const result = weaponFitAtLocation(catalog, draft, 'right_torso', 'machine_gun');

    expect(reasonCodes(result)).toEqual(['location_slots']);
    expect(result.requiredSlots).toBe(2);
    expect(result.automaticAmmoSlots).toBe(1);
    expect(result.freeSlots).toBe(1);
    expect(result.reasons[0]?.message).toBe(
      'Machine Gun and its automatic ammunition need 2 slots; Right Torso has 1 slot free.',
    );
  });

  it('returns only locations that accept the next shelf action', () => {
    const draft = design();

    expect(compatibleLocations(catalog, draft, 'medium_laser')).toEqual(['right_torso']);
    expect(
      compatibleLocations(catalog, draft, 'medium_laser', new Map([['medium_laser', 3]])),
    ).toEqual([]);
  });
});

describe('shelf filters', () => {
  it('offers ammunition only for mounted ammo-fed weapons', () => {
    const draft = design();
    draft.ammo = [{ weaponId: 'gauss_rifle', location: 'left_torso', tons: 1 }];
    draft.mounts.push({ weaponId: 'ac5', location: 'right_torso' });

    expect(ammoShelfWeapons(catalog, draft).map((weapon) => weapon.id).sort()).toEqual([
      'ac5',
      'srm6',
    ]);
    expect(ammoShelfWeapons(catalog, design('wisp_scout'))).toEqual([]);
  });

  it('filters jump jets by chassis capability and campaign stock', () => {
    const jumpJet = catalog.equipment.get('jump_jet');
    const sentinel = catalog.chassis.get('sentinel_snl2');
    const wisp = catalog.chassis.get('wisp_wsp1');
    if (jumpJet === undefined || sentinel === undefined || wisp === undefined) {
      throw new Error('missing jump-jet fixture');
    }

    expect(equipmentFitsChassis(sentinel, jumpJet)).toBe(false);
    expect(equipmentFitsChassis(wisp, jumpJet)).toBe(true);
    expect(
      equipmentShelfItems(
        catalog,
        design(),
        new Map([
          ['jump_jet', 1],
          ['case', 2],
        ]),
      ).map((equipment) => equipment.id),
    ).toEqual(['case']);
    expect(
      equipmentShelfItems(catalog, design('wisp_scout'), new Map([['jump_jet', 3]])).map(
        (equipment) => equipment.id,
      ),
    ).toEqual(['jump_jet']);
  });
});
