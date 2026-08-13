import type { Chassis } from '../../schema/chassis';
import type { MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import { weaponSize, weaponSizeLabel, type LocationUsage } from '../../sim/loadout';

const SHORT_NAMES: Record<MechLocation, string> = {
  head: 'Head',
  centre_torso: 'Centre Torso',
  left_torso: 'Left Torso',
  right_torso: 'Right Torso',
  left_arm: 'Left Arm',
  right_arm: 'Right Arm',
  left_leg: 'Left Leg',
  right_leg: 'Right Leg',
};

export interface DropPayload {
  kind: 'weapon' | 'equipment' | 'ammo';
  id: string;
}

interface Props {
  catalog: Catalog;
  chassis: Chassis;
  design: Design;
  location: MechLocation;
  usage: LocationUsage;
  onDrop: (payload: DropPayload, location: MechLocation) => void;
  onRemoveMount: (index: number) => void;
  onRemoveAmmo: (index: number) => void;
  onRemoveEquipment: (index: number) => void;
  onArmourChange: (location: MechLocation, value: number) => void;
}

export function LocationCard({
  catalog,
  chassis,
  design,
  location,
  usage,
  onDrop,
  onRemoveMount,
  onRemoveAmmo,
  onRemoveEquipment,
  onArmourChange,
}: Props) {
  const hardpoints = chassis.hardpoints[location];
  const slotsOver = usage.slotsUsed > usage.slotsAvailable;

  const hardpointOver = (['energy', 'ballistic', 'missile'] as const).some(
    (type) => usage.hardpointsUsed[type] > usage.hardpointsAvailable[type],
  );

  const oversized = (weaponId: string): boolean => {
    const weapon = catalog.weapons.get(weaponId);
    return weapon !== undefined && weaponSize(catalog, weapon) > usage.size;
  };
  const sizeOver = design.mounts.some(
    (mount) => mount.location === location && oversized(mount.weaponId),
  );

  // The location's place on the body plan, so the bay reads as a mech.
  const classes = ['bay-location', `loc-${location}`];
  if (slotsOver || hardpointOver || sizeOver) classes.push('invalid');

  return (
    <div
      className={classes.join(' ')}
      data-testid={`bay-location-${location}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const raw = event.dataTransfer.getData('application/ironline');
        if (raw === '') return;
        onDrop(JSON.parse(raw) as DropPayload, location);
      }}
    >
      <header>
        <span className="bay-location-name">{SHORT_NAMES[location]}</span>
        <span className={`bay-slots ${slotsOver ? 'over' : ''}`} data-testid={`slots-${location}`}>
          {usage.slotsUsed}/{usage.slotsAvailable} slots
        </span>
      </header>

      <div className="bay-hardpoints">
        {(['energy', 'ballistic', 'missile'] as const).map((type) =>
          hardpoints[type] === 0 ? null : (
            <span
              key={type}
              className={`pip ${type} ${usage.hardpointsUsed[type] > hardpoints[type] ? 'over' : ''}`}
            >
              {type.slice(0, 1).toUpperCase()} {usage.hardpointsUsed[type]}/{hardpoints[type]}
            </span>
          ),
        )}
        {/* What this location's mounts were built around. Without it the only
            way to learn a scout arm will not take a gauss rifle is to fit one
            and read the complaint. */}
        <span
          className={`pip size ${sizeOver ? 'over' : ''}`}
          title={`Takes ${weaponSizeLabel(catalog, usage.size)} weapons and smaller`}
          data-testid={`size-${location}`}
        >
          ≤ {weaponSizeLabel(catalog, usage.size)}
        </span>
      </div>

      <ul className="bay-items">
        {design.mounts.map((mount, index) =>
          mount.location !== location ? null : (
            <li key={`m${index}`} className={oversized(mount.weaponId) ? 'too-big' : undefined}>
              <span>{catalog.weapons.get(mount.weaponId)?.name ?? mount.weaponId}</span>
              <button type="button" onClick={() => onRemoveMount(index)} title="Remove">
                ×
              </button>
            </li>
          ),
        )}
        {design.ammo.map((load, index) =>
          load.location !== location ? null : (
            <li key={`a${index}`} className="ammo">
              <span>
                {catalog.weapons.get(load.weaponId)?.name ?? load.weaponId} ammo × {load.tons}t
              </span>
              <button type="button" onClick={() => onRemoveAmmo(index)} title="Remove one ton">
                ×
              </button>
            </li>
          ),
        )}
        {design.equipment.map((fit, index) =>
          fit.location !== location ? null : (
            <li key={`e${index}`} className="equipment">
              <span>{catalog.equipment.get(fit.equipmentId)?.name ?? fit.equipmentId}</span>
              <button type="button" onClick={() => onRemoveEquipment(index)} title="Remove">
                ×
              </button>
            </li>
          ),
        )}
      </ul>

      <label className="bay-armour">
        <span>
          Armour {design.armour[location]}/{chassis.armourMax[location]}
        </span>
        <input
          type="range"
          min={0}
          max={chassis.armourMax[location]}
          value={design.armour[location]}
          onChange={(event) => onArmourChange(location, Number(event.target.value))}
          data-testid={`armour-${location}`}
        />
      </label>
    </div>
  );
}
