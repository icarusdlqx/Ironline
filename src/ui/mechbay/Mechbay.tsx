import { useEffect, useMemo, useRef, useState } from 'react';
import type { MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import { getCatalog } from '../../schema/load';
import { computeHeatProfile, computeLoadout } from '../../sim/loadout';
import {
  addAmmo,
  addEquipment,
  addMount,
  designIssues,
  exportDesign,
  InvalidBuildError,
  listStoredDesigns,
  loadFromStorage,
  parseDesign,
  removeAmmo,
  removeEquipment,
  removeMount,
  saveToStorage,
  setName,
} from './editor';
import { BayChrome, type BayStatus } from './BayChrome';
import {
  compatibleLocations,
  remainingInventory,
  weaponFitAtLocation,
} from './bayFit';
import { LoadoutGrid } from './LoadoutGrid';
import type { DropPayload } from './LocationCard';
import { MachinePanel } from './MachinePanel';
import { StoreShelf, type Shelf } from './StoreShelf';

const catalog = getCatalog();

export interface BayCommission {
  title: string;
  design: Design;
  cancelLabel?: string;
  /** Omitted for the unlimited skirmish workshop. */
  inventory?: ReadonlyMap<string, number>;
  onCommit: (design: Design) => { ok: boolean; reason: string | null };
  onCancel: () => void;
}

function cloneDesign(design: Design): Design {
  return structuredClone(design);
}

export function guidedWeaponId(
  armed: DropPayload | null,
  hoveredWeaponId: string | null,
): string | null {
  return armed?.kind === 'weapon' ? armed.id : hoveredWeaponId;
}

export function Mechbay({
  onExit,
  commission,
}: {
  onExit: () => void;
  commission?: BayCommission;
}) {
  const initial = commission?.design ?? catalog.designs.get('sentinel_brawler');
  if (initial === undefined) throw new Error('missing default mechbay design');

  const [design, setDesign] = useState<Design>(() => cloneDesign(initial));
  const [status, setStatus] = useState<BayStatus | null>(null);
  const [stored, setStored] = useState<string[]>(() => listStoredDesigns());
  const [shelf, setShelf] = useState<Shelf>('weapons');
  const [inspected, setInspected] = useState<DropPayload | null>(null);
  const [armed, setArmed] = useState<DropPayload | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<MechLocation | null>(null);
  const [hoveredLocation, setHoveredLocation] = useState<MechLocation | null>(null);
  const [hoveredWeaponId, setHoveredWeaponId] = useState<string | null>(null);
  const bayRef = useRef<HTMLDivElement>(null);

  const chassis = catalog.chassis.get(design.chassisId);
  const loadout = useMemo(() => computeLoadout(catalog, design), [design]);
  const heat = useMemo(() => computeHeatProfile(catalog, design), [design]);
  const issues = useMemo(() => designIssues(catalog, design), [design]);
  const saveable = issues.length === 0;
  const inventory = commission?.inventory;
  const remaining = useMemo(() => remainingInventory(inventory, design), [inventory, design]);
  const guideWeaponId = guidedWeaponId(armed, hoveredWeaponId);
  const compatible = useMemo(
    () =>
      new Set(
        guideWeaponId === null
          ? []
          : compatibleLocations(catalog, design, guideWeaponId, inventory),
      ),
    [design, guideWeaponId, inventory],
  );

  useEffect(() => {
    if (armed === null) return;
    const bay = bayRef.current;
    const view = bay?.ownerDocument.defaultView;
    if (
      bay === null ||
      view === null ||
      view === undefined ||
      !view.matchMedia('(max-width: 640px), (pointer: coarse) and (max-width: 1100px)').matches
    ) {
      return;
    }
    const target = selectedLocation ?? compatible.values().next().value;
    if (target === undefined || target === null) return;
    const frame = view.requestAnimationFrame(() => {
      const card = bay.querySelector<HTMLElement>(`[data-testid="bay-location-${target}"]`);
      if (card === null) return;
      card.scrollIntoView({ block: 'center' });
      card.querySelector<HTMLButtonElement>('.bay-location-name')?.focus({ preventScroll: true });
    });
    return () => view.cancelAnimationFrame(frame);
  }, [armed, compatible, selectedLocation]);

  if (chassis === undefined) return <div className="bay">unknown chassis {design.chassisId}</div>;

  const apply = (next: Design): void => {
    if (next.chassisId !== design.chassisId) {
      setSelectedLocation(null);
      setHoveredLocation(null);
      setHoveredWeaponId(null);
      setArmed(null);
      setInspected(null);
      setShowAll(false);
    }
    setDesign(next);
    setStatus(null);
  };

  const replace = (next: Design): void => {
    setSelectedLocation(null);
    setHoveredLocation(null);
    setHoveredWeaponId(null);
    setArmed(null);
    setInspected(null);
    setShowAll(false);
    setDesign(next);
    setStatus(null);
  };

  const onDrop = (payload: DropPayload, location: MechLocation): void => {
    if (payload.kind === 'weapon') {
      const fit = weaponFitAtLocation(catalog, design, location, payload.id, inventory);
      if (!fit.ok) {
        setSelectedLocation(location);
        setStatus({ tone: 'error', text: fit.reasons[0]?.message ?? 'That weapon does not fit.' });
        return;
      }
      let next = addMount(design, payload.id, location);
      if (catalog.weapons.get(payload.id)?.ammoPerTon !== null) {
        next = addAmmo(next, payload.id, location);
      }
      apply(next);
    } else if (payload.kind === 'ammo') apply(addAmmo(design, payload.id, location));
    else apply(addEquipment(design, payload.id, location));
    setSelectedLocation(location);
    setArmed(null);
  };

  const selectLocation = (location: MechLocation): void => {
    if (armed !== null) {
      onDrop(armed, location);
      return;
    }
    setSelectedLocation((current) => current === location ? null : location);
    setShelf('weapons');
  };

  const onSave = (): void => {
    if (commission !== undefined) {
      const result = commission.onCommit(design);
      if (!result.ok) setStatus({ tone: 'error', text: result.reason ?? 'refit refused' });
      return;
    }
    try {
      const { replaced } = saveToStorage(catalog, design);
      setStored(listStoredDesigns());
      setStatus({
        tone: 'ok',
        text: replaced
          ? `Saved "${design.name}", replacing the build already under that name.`
          : `Saved "${design.name}".`,
      });
    } catch (error) {
      if (error instanceof InvalidBuildError) {
        setStatus({ tone: 'error', text: `Cannot save — ${error.issues.join('; ')}` });
        return;
      }
      throw error;
    }
  };

  const onExport = (): void => {
    try {
      const url = URL.createObjectURL(exportDesign(catalog, design));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${design.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({ tone: 'ok', text: `Exported "${design.name}".` });
    } catch (error) {
      if (error instanceof InvalidBuildError) {
        setStatus({ tone: 'error', text: `Cannot export — ${error.issues.join('; ')}` });
        return;
      }
      throw error;
    }
  };

  const onImport = async (file: File): Promise<void> => {
    const result = parseDesign(await file.text());
    if (result.design === null) {
      setStatus({ tone: 'error', text: `Import failed — ${result.error ?? 'unknown error'}` });
      return;
    }
    replace(result.design);
    setStatus({ tone: 'ok', text: `Imported "${result.design.name}".` });
  };

  return (
    <div ref={bayRef} className="bay" data-testid="mechbay">
      <BayChrome
        catalog={catalog}
        design={design}
        {...(commission === undefined ? {} : {
          commissionTitle: commission.title,
          commissionCancelLabel: commission.cancelLabel,
        })}
        stored={stored}
        saveable={saveable}
        status={status}
        onNameChange={(name) => apply(setName(design, name))}
        onDesignPick={replace}
        onReset={() => {
          const factory = [...catalog.designs.values()].find(
            (entry) => entry.chassisId === design.chassisId,
          );
          if (factory === undefined) return;
          replace(cloneDesign(factory));
          setStatus({ tone: 'ok', text: `Back to the stock ${factory.name} loadout.` });
        }}
        onExit={commission?.onCancel ?? onExit}
        onSave={onSave}
        onExport={onExport}
        onImport={(file) => void onImport(file)}
        onLoad={(id) => {
          const result = loadFromStorage(id);
          if (result.design === null) {
            setStatus({ tone: 'error', text: result.error ?? 'load failed' });
            return;
          }
          replace(result.design);
          setStatus({ tone: 'ok', text: `Loaded "${result.design.name}".` });
        }}
      />

      <MachinePanel
        catalog={catalog}
        chassis={chassis}
        design={design}
        loadout={loadout}
        heat={heat}
        issues={issues}
        selectedLocation={selectedLocation}
        hoveredLocation={hoveredLocation}
        compatibleLocations={compatible}
        heatSinkAvailable={(id) => remaining === undefined || (remaining.get(id) ?? 0) > 0}
        onApply={apply}
        onSelectLocation={selectLocation}
        onHoverLocation={setHoveredLocation}
      />

      <LoadoutGrid
        catalog={catalog}
        chassis={chassis}
        design={design}
        loadout={loadout}
        armed={armed}
        selectedLocation={selectedLocation}
        hoveredLocation={hoveredLocation}
        compatibleLocations={compatible}
        onCancelArmed={() => setArmed(null)}
        onDrop={onDrop}
        onRemoveMount={(index) => apply(removeMount(design, index))}
        onRemoveAmmo={(index) => apply(removeAmmo(design, index))}
        onRemoveEquipment={(index) => apply(removeEquipment(design, index))}
        onInspect={setInspected}
        onSelectLocation={selectLocation}
        onHoverLocation={setHoveredLocation}
      />

      <StoreShelf
        catalog={catalog}
        chassis={chassis}
        design={design}
        inventory={inventory}
        shelf={shelf}
        showAll={showAll}
        selectedLocation={selectedLocation}
        armed={armed}
        inspected={inspected}
        onShelfChange={setShelf}
        onShowAllChange={setShowAll}
        onClearLocation={() => setSelectedLocation(null)}
        onInspect={setInspected}
        onArm={(payload) => {
          setInspected(payload);
          setArmed(payload);
        }}
        onHoverWeapon={setHoveredWeaponId}
      />
    </div>
  );
}
