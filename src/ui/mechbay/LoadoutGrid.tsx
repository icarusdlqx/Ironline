import { LOCATIONS, type MechLocation } from '../../schema/common';
import type { Chassis } from '../../schema/chassis';
import type { Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import type { Loadout } from '../../sim/loadout';
import { LocationCard, type DropPayload } from './LocationCard';

interface Props {
  catalog: Catalog;
  chassis: Chassis;
  design: Design;
  loadout: Loadout;
  armed: DropPayload | null;
  selectedLocation: MechLocation | null;
  hoveredLocation: MechLocation | null;
  compatibleLocations: ReadonlySet<MechLocation>;
  onCancelArmed: () => void;
  onDrop: (payload: DropPayload, location: MechLocation) => void;
  onRemoveMount: (index: number) => void;
  onRemoveAmmo: (index: number) => void;
  onRemoveEquipment: (index: number) => void;
  onInspect: (payload: DropPayload) => void;
  onSelectLocation: (location: MechLocation) => void;
  onHoverLocation: (location: MechLocation | null) => void;
}

export function LoadoutGrid({
  catalog,
  chassis,
  design,
  loadout,
  armed,
  selectedLocation,
  hoveredLocation,
  compatibleLocations,
  onCancelArmed,
  onDrop,
  onRemoveMount,
  onRemoveAmmo,
  onRemoveEquipment,
  onInspect,
  onSelectLocation,
  onHoverLocation,
}: Props) {
  const heldName =
    armed?.kind === 'equipment'
      ? (catalog.equipment.get(armed.id)?.name ?? armed.id)
      : armed === null
        ? ''
        : `${catalog.weapons.get(armed.id)?.name ?? armed.id}${armed.kind === 'ammo' ? ' ammo' : ''}`;

  return (
    <section className="bay-grid" data-testid="bay-grid">
      {armed === null ? null : (
        <div className="bay-armed-banner" data-testid="bay-armed">
          <span>
            Holding <strong>{heldName}</strong> — choose a highlighted location.
          </span>
          <button type="button" onClick={onCancelArmed} data-testid="bay-armed-cancel">
            Put it back
          </button>
        </div>
      )}
      {LOCATIONS.map((location) => (
        <LocationCard
          key={location}
          catalog={catalog}
          chassis={chassis}
          design={design}
          location={location}
          usage={loadout.perLocation[location]}
          onDrop={onDrop}
          onRemoveMount={onRemoveMount}
          onRemoveAmmo={onRemoveAmmo}
          onRemoveEquipment={onRemoveEquipment}
          onInspect={onInspect}
          onSelect={onSelectLocation}
          onHover={onHoverLocation}
          selected={selectedLocation === location}
          hovered={hoveredLocation === location}
          compatible={compatibleLocations.has(location)}
          armed={armed}
        />
      ))}
    </section>
  );
}
