import type { Chassis } from '../../schema/chassis';
import type { MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import type { Equipment } from '../../schema/equipment';
import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';
import { computeLoadout } from '../../sim/loadout';
import {
  ammoShelfWeapons,
  compatibleLocations as findCompatibleLocations,
  equipmentShelfItems,
  remainingInventory,
  weaponFitAtLocation,
  type BayInventory,
} from './bayFit';
import { Dossier, type Inspected } from './Dossier';
import type { DropPayload } from './LocationCard';
import { WeaponCard } from './WeaponCard';
import { WEAPON_CATEGORIES, weaponsByCategory } from './weaponPresentation';

export type Shelf = 'weapons' | 'ammo' | 'equipment';

function ShelfItem({
  payload,
  label,
  detail,
  stock,
  armed,
  onInspect,
  onArm,
}: {
  payload: DropPayload;
  label: string;
  detail: string;
  stock?: number;
  armed: boolean;
  onInspect: (payload: DropPayload) => void;
  onArm: (payload: DropPayload) => void;
}) {
  const exhausted = stock !== undefined && stock <= 0;
  return (
    <li className={`bay-stock${exhausted ? ' exhausted' : ''}${armed ? ' armed' : ''}`}>
      <button
        type="button"
        draggable={!exhausted}
        aria-pressed={armed}
        aria-disabled={exhausted || undefined}
        data-testid={`stock-${payload.kind}-${payload.id}`}
        onFocus={() => onInspect(payload)}
        onClick={() => {
          onInspect(payload);
          if (!exhausted) onArm(payload);
        }}
        onDragStart={(event) => {
          if (exhausted) return event.preventDefault();
          onInspect(payload);
          event.dataTransfer.setData('application/ironline', JSON.stringify(payload));
          event.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <span className="stock-name">
          {label}
          {stock === undefined ? null : <em className="stock-count">×{Math.max(0, stock)}</em>}
        </span>
        <span className="stock-detail">{detail}</span>
      </button>
    </li>
  );
}

function selectedEquipmentFits(
  catalog: Catalog,
  design: Design,
  equipment: Equipment,
  location: MechLocation | null,
): boolean {
  if (location === null) return true;
  const usage = computeLoadout(catalog, design).perLocation[location];
  return equipment.slots <= usage.slotsAvailable - usage.slotsUsed;
}

interface Props {
  catalog: Catalog;
  chassis: Chassis;
  design: Design;
  inventory: BayInventory;
  shelf: Shelf;
  showAll: boolean;
  selectedLocation: MechLocation | null;
  armed: DropPayload | null;
  inspected: Inspected | null;
  onShelfChange: (shelf: Shelf) => void;
  onShowAllChange: (show: boolean) => void;
  onClearLocation: () => void;
  onInspect: (payload: DropPayload) => void;
  onArm: (payload: DropPayload) => void;
  onHoverWeapon: (weaponId: string | null) => void;
}

export function StoreShelf({
  catalog,
  chassis,
  design,
  inventory,
  shelf,
  showAll,
  selectedLocation,
  armed,
  inspected,
  onShelfChange,
  onShowAllChange,
  onClearLocation,
  onInspect,
  onArm,
  onHoverWeapon,
}: Props) {
  const remaining = remainingInventory(inventory, design);
  const mountedWeapons = design.mounts
    .map((mount) => catalog.weapons.get(mount.weaponId))
    .filter((weapon): weapon is Weapon => weapon !== undefined);
  const mountedWeaponIds = new Set(mountedWeapons.map((weapon) => weapon.id));
  const knownWeapons = [...catalog.weapons.values()].filter(
    (weapon) => inventory === undefined || inventory.has(weapon.id),
  );
  const weaponFits = (weapon: Weapon): { ok: boolean; reason: string | null } => {
    if (selectedLocation !== null) {
      const fit = weaponFitAtLocation(catalog, design, selectedLocation, weapon.id, inventory);
      return { ok: fit.ok, reason: fit.reasons[0]?.message ?? null };
    }
    const locations = findCompatibleLocations(catalog, design, weapon.id, inventory);
    return {
      ok: locations.length > 0,
      reason: locations.length > 0 ? null : 'No free compatible hardpoint on this chassis.',
    };
  };
  const shownWeapons = knownWeapons.filter(
    (weapon) =>
      showAll ||
      weaponFits(weapon).ok ||
      (selectedLocation === null && mountedWeaponIds.has(weapon.id)),
  );
  const groups = weaponsByCategory(catalog, shownWeapons);
  const ammo = ammoShelfWeapons(catalog, design).filter(() => {
    if (selectedLocation === null) return true;
    const usage = computeLoadout(catalog, design).perLocation[selectedLocation];
    return catalog.rules.construction.ammoSlotsPerTon <= usage.slotsAvailable - usage.slotsUsed;
  });
  const gear = equipmentShelfItems(catalog, design, inventory).filter((entry) =>
    selectedEquipmentFits(catalog, design, entry, selectedLocation),
  );
  const selectedName = selectedLocation?.replaceAll('_', ' ') ?? null;

  return (
    <section className="bay-side" data-testid="bay-shelf">
      <div className="bay-shelf-head">
        <div className="bay-shelf-tabs" role="tablist">
          {(['weapons', 'ammo', 'equipment'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={shelf === tab}
              className={shelf === tab ? 'active' : ''}
              onClick={() => onShelfChange(tab)}
              data-testid={`shelf-${tab}`}
            >
              {tab}
            </button>
          ))}
        </div>
        {selectedName === null ? null : (
          <div className="bay-location-filter" data-testid="bay-location-filter">
            <span>Fitting {selectedName}</span>
            <button type="button" onClick={onClearLocation}>Clear filter</button>
          </div>
        )}
        {shelf !== 'weapons' ? null : (
          <label className="bay-show-all">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => onShowAllChange(event.target.checked)}
              data-testid="shelf-show-all"
            />
            {selectedName === null
              ? 'Show weapons this hull cannot mount'
              : 'Show incompatible for this mount'}
          </label>
        )}
      </div>

      <div className="bay-stocks" data-testid="bay-stocks">
        {shelf === 'weapons' ? (
          shownWeapons.length === 0 ? (
            <p className="bay-shelf-empty">
              Nothing on the shelf fits {selectedName ?? 'this chassis'}. Clear the filter or free a slot.
            </p>
          ) : (
            WEAPON_CATEGORIES.map((category) => {
              const weapons = groups.get(category.id) ?? [];
              if (weapons.length === 0) return null;
              return (
                <section className="weapon-category" key={category.id}>
                  <h4>{category.label}</h4>
                  <ul>
                    {weapons.map((weapon) => {
                      const fit = weaponFits(weapon);
                      return (
                        <li key={weapon.id}>
                          <WeaponCard
                            catalog={catalog}
                            weapon={weapon}
                            mountedWeapons={mountedWeapons}
                            chassisFaction={chassis.faction}
                            stock={remaining?.get(weapon.id)}
                            selected={armed?.kind === 'weapon' && armed.id === weapon.id}
                            unavailableReason={fit.ok ? null : fit.reason}
                            testId={`stock-weapon-${weapon.id}`}
                            onInspect={() => onInspect({ kind: 'weapon', id: weapon.id })}
                            onPick={() => onArm({ kind: 'weapon', id: weapon.id })}
                            onHover={(hovered) => onHoverWeapon(hovered ? weapon.id : null)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )
        ) : null}

        {shelf === 'ammo' ? (
          <ul className="bay-simple-stocks">
            {ammo.map((weapon) => (
              <ShelfItem
                key={weapon.id}
                payload={{ kind: 'ammo', id: weapon.id }}
                label={`${weapon.name} ammunition`}
                detail={`1 ton · ${weapon.ammoPerTon ?? 0} rounds`}
                armed={armed?.kind === 'ammo' && armed.id === weapon.id}
                onInspect={onInspect}
                onArm={onArm}
              />
            ))}
          </ul>
        ) : null}

        {shelf === 'equipment' ? (
          <ul className="bay-simple-stocks">
            {gear.map((entry) => (
              <ShelfItem
                key={entry.id}
                payload={{ kind: 'equipment', id: entry.id }}
                label={entry.name}
                detail={`${entry.tonnage}t · ${entry.slots} slot${entry.slots === 1 ? '' : 's'}`}
                stock={remaining?.get(entry.id)}
                armed={armed?.kind === 'equipment' && armed.id === entry.id}
                onInspect={onInspect}
                onArm={onArm}
              />
            ))}
          </ul>
        ) : null}
      </div>

      {shelf === 'weapons' ? null : (
        <Dossier catalog={catalog} inspected={inspected} heatSinkId={design.heatSinkId} />
      )}
    </section>
  );
}
