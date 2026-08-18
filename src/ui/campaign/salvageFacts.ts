import type { EquipmentCategory } from '../../schema/equipment';
import type { Catalog } from '../../schema/load';
import { LOCATIONS } from '../../schema/common';
import { storeItemSaleBasis, storeItemValueOf } from '../../campaign/market';
import { storeCount, type CampaignState, type StoreItem } from '../../campaign/types';
import { weaponSize, weaponSizeLabel } from '../../sim/loadout';

export interface SalvageItemFacts {
  name: string;
  kind: string;
  specification: string;
  fit: string;
  ownedBefore: number;
  buildValue: number;
  saleBasis: number;
}

const EQUIPMENT_KINDS: Record<EquipmentCategory, string> = {
  heat_sink: 'heat sink',
  jump_jet: 'jump gear',
  electronics: 'electronics',
  defensive: 'defensive gear',
  targeting: 'targeting gear',
};

function plural(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function ownedChassisNames(
  catalog: Catalog,
  state: CampaignState,
  accepts: (chassisId: string) => boolean,
): string[] {
  const names = new Set<string>();
  for (const mech of state.mechs) {
    if (!accepts(mech.design.chassisId)) continue;
    names.add(catalog.chassis.get(mech.design.chassisId)?.name ?? mech.design.chassisId);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function salvageItemFacts(
  catalog: Catalog,
  state: CampaignState,
  item: StoreItem,
  takenCount: number,
): SalvageItemFacts {
  const ownedBefore = Math.max(0, storeCount(state, item.kind, item.itemId) - takenCount);
  const buildValue = storeItemValueOf(catalog, item);
  const saleBasis = storeItemSaleBasis(catalog, item);

  if (item.kind === 'weapon') {
    const weapon = catalog.weapons.get(item.itemId);
    if (weapon === undefined) {
      return {
        name: item.itemId,
        kind: 'Unknown weapon',
        specification: 'No catalogue record',
        fit: 'Compatibility unavailable',
        ownedBefore,
        buildValue,
        saleBasis,
      };
    }

    const size = weaponSize(catalog, weapon);
    const mount = `${weaponSizeLabel(catalog, size)} ${weapon.type} hardpoint`;
    const compatible = ownedChassisNames(catalog, state, (chassisId) => {
      const chassis = catalog.chassis.get(chassisId);
      return (
        chassis !== undefined &&
        LOCATIONS.some((location) => {
          const hardpoint = chassis.hardpoints[location];
          return hardpoint[weapon.type] > 0 && hardpoint.size >= size;
        })
      );
    });

    return {
      name: weapon.name,
      kind: 'Weapon',
      specification: `${mount} · ${weapon.tonnage}t · ${plural(weapon.slots, 'slot')}`,
      fit:
        compatible.length > 0
          ? `Owned hardpoint match: ${compatible.join(', ')}`
          : `No owned chassis has a ${mount}`,
      ownedBefore,
      buildValue,
      saleBasis,
    };
  }

  const equipment = catalog.equipment.get(item.itemId);
  if (equipment === undefined) {
    return {
      name: item.itemId,
      kind: 'Unknown equipment',
      specification: 'No catalogue record',
      fit: 'Compatibility unavailable',
      ownedBefore,
      buildValue,
      saleBasis,
    };
  }

  const jumpCapable = ownedChassisNames(
    catalog,
    state,
    (chassisId) => catalog.chassis.get(chassisId)?.jumpCapable === true,
  );
  return {
    name: equipment.name,
    kind: 'Equipment',
    specification: `${EQUIPMENT_KINDS[equipment.category]} · ${equipment.tonnage}t · ${plural(equipment.slots, 'slot')}`,
    fit:
      equipment.category === 'jump_jet'
        ? jumpCapable.length > 0
          ? `Jump-capable owned chassis: ${jumpCapable.join(', ')}`
          : 'No owned chassis is jump-capable'
        : 'No hardpoint required; tonnage and slots are checked in the bay',
    ownedBefore,
    buildValue,
    saleBasis,
  };
}
