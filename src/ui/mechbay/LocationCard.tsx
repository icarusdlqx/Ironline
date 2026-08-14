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

/** One thing bolted into this location, and how much room it takes. */
interface Occupant {
  key: string;
  kind: 'weapon' | 'ammo' | 'equipment';
  index: number;
  label: string;
  slots: number;
  /** Colours the block by what it is: energy, ballistic, missile, ammo, gear. */
  tone: string;
  /** True when the mount is too small for what has been put in it. */
  oversized: boolean;
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
  /** Called when the player picks something here, so the dossier can follow. */
  onInspect?: (payload: DropPayload) => void;
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
  onInspect,
}: Props) {
  const hardpoints = chassis.hardpoints[location];
  const slotsOver = usage.slotsUsed > usage.slotsAvailable;

  const hardpointOver = (['energy', 'ballistic', 'missile'] as const).some(
    (type) => usage.hardpointsUsed[type] > usage.hardpointsAvailable[type],
  );

  // Everything fitted here, in the order it was bolted on, with the room it
  // takes. This is the loadout as the machine actually carries it.
  const occupants: Occupant[] = [];
  let sizeOver = false;

  design.mounts.forEach((mount, index) => {
    if (mount.location !== location) return;
    const weapon = catalog.weapons.get(mount.weaponId);
    const oversized = weapon !== undefined && weaponSize(catalog, weapon) > usage.size;
    if (oversized) sizeOver = true;
    occupants.push({
      key: `m${index}`,
      kind: 'weapon',
      index,
      label: weapon?.name ?? mount.weaponId,
      slots: weapon?.slots ?? 1,
      tone: weapon?.type ?? 'energy',
      oversized,
    });
  });

  design.ammo.forEach((load, index) => {
    if (load.location !== location) return;
    const weapon = catalog.weapons.get(load.weaponId);
    occupants.push({
      key: `a${index}`,
      kind: 'ammo',
      index,
      label: `${weapon?.name ?? load.weaponId} ammo ×${load.tons}`,
      slots: Math.max(1, Math.round(load.tons * catalog.rules.construction.ammoSlotsPerTon)),
      tone: 'ammo',
      oversized: false,
    });
  });

  design.equipment.forEach((fit, index) => {
    if (fit.location !== location) return;
    const gear = catalog.equipment.get(fit.equipmentId);
    occupants.push({
      key: `e${index}`,
      kind: 'equipment',
      index,
      label: gear?.name ?? fit.equipmentId,
      slots: gear?.slots ?? 1,
      tone: 'gear',
      oversized: false,
    });
  });

  const filled = occupants.reduce((total, item) => total + item.slots, 0);
  const empty = Math.max(0, usage.slotsAvailable - filled);

  const remove = (item: Occupant): void => {
    if (item.kind === 'weapon') onRemoveMount(item.index);
    else if (item.kind === 'ammo') onRemoveAmmo(item.index);
    else onRemoveEquipment(item.index);
  };

  // One column per slot, so a block spans exactly the room it occupies and the
  // shape of a build is legible at a glance: a gauss rifle is visibly most of
  // an arm, and two free slots visibly will not take one.
  const columns = Math.max(1, Math.min(usage.slotsAvailable, 12));

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
          {usage.slotsUsed}/{usage.slotsAvailable}
        </span>
      </header>

      <div className="bay-hardpoints">
        {(['energy', 'ballistic', 'missile'] as const).map((type) =>
          hardpoints[type] === 0 ? null : (
            <span
              key={type}
              className={`pip ${type} ${usage.hardpointsUsed[type] > hardpoints[type] ? 'over' : ''}`}
              title={`${type} hardpoints`}
            >
              {type.slice(0, 1).toUpperCase()} {usage.hardpointsUsed[type]}/{hardpoints[type]}
            </span>
          ),
        )}
        <span
          className={`pip size ${sizeOver ? 'over' : ''}`}
          title={`Takes ${weaponSizeLabel(catalog, usage.size)} weapons and smaller`}
          data-testid={`size-${location}`}
        >
          ≤ {weaponSizeLabel(catalog, usage.size)}
        </span>
      </div>

      <ul
        className="bay-slotgrid"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        data-testid={`slots-grid-${location}`}
      >
        {occupants.map((item) => (
          <li
            key={item.key}
            className={`slot-block tone-${item.tone}${item.oversized ? ' too-big' : ''}`}
            style={{ gridColumn: `span ${Math.min(item.slots, columns)}` }}
            title={
              item.oversized
                ? `${item.label} — too large for this mount`
                : `${item.label} — ${item.slots} slot${item.slots === 1 ? '' : 's'}. Click to remove.`
            }
          >
            <button
              type="button"
              onClick={() => remove(item)}
              onFocus={() =>
                onInspect?.({
                  kind: item.kind,
                  id:
                    item.kind === 'weapon'
                      ? (design.mounts[item.index]?.weaponId ?? '')
                      : item.kind === 'ammo'
                        ? (design.ammo[item.index]?.weaponId ?? '')
                        : (design.equipment[item.index]?.equipmentId ?? ''),
                })
              }
            >
              {item.label}
            </button>
          </li>
        ))}
        {Array.from({ length: empty }, (_, index) => (
          <li key={`free-${index}`} className="slot-block empty" />
        ))}
      </ul>

      {/* Armour reads here and is set from the machine column: one slider for
          the whole mech, with per-location detail behind a disclosure. */}
      <span className="bay-armour-read" title="Armour on this location">
        {design.armour[location]}/{chassis.armourMax[location]} armour
      </span>
    </div>
  );
}
