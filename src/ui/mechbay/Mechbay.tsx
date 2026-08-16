import { useMemo, useState } from 'react';
import { LOCATIONS, type MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import { getCatalog } from '../../schema/load';
import { computeHeatProfile, computeLoadout, weaponSize, weaponSizeLabel } from '../../sim/loadout';
import {
  addAmmo,
  addEquipment,
  addMount,
  designIssues,
  exportDesign,
  InvalidBuildError,
  listStoredDesigns,
  loadFromStorage,
  maximiseArmour,
  parseDesign,
  removeAmmo,
  removeEquipment,
  fitCooling,
  removeMount,
  saveToStorage,
  spreadArmour,
  setArmour,
  setHeatSinkId,
  setHeatSinks,
  setName,
} from './editor';
import { ChassisSilhouette } from './ChassisSilhouette';
import { Dossier, type Inspected } from './Dossier';
import { LocationCard, type DropPayload } from './LocationCard';

const catalog = getCatalog();

type Shelf = 'weapons' | 'ammo' | 'equipment';

/**
 * How the bay may be opened.
 *
 * A standalone visit is a sandbox: every weapon in the catalogue, saved to
 * browser storage. Opened from a dropship manifest it is a refit of one
 * machine the company owns, so the shelves hold only what is actually in
 * stores and the finished build goes back to the campaign rather than to
 * localStorage.
 */
export interface BayCommission {
  /** Shown instead of the design picker: which mech is on the gantry. */
  title: string;
  design: Design;
  /**
   * How many of each item the company has spare, by item id. Absent means the
   * whole catalogue is on the shelves — a skirmish outfit, where nothing is
   * being paid for, as opposed to a campaign refit booked through stores.
   */
  inventory?: ReadonlyMap<string, number>;
  onCommit: (design: Design) => { ok: boolean; reason: string | null };
  onCancel: () => void;
}

function Draggable({
  payload,
  label,
  detail,
  note,
  unmountable = false,
  stock,
  onInspect,
  onArm,
  armed = false,
}: {
  payload: DropPayload;
  label: string;
  detail: string;
  note?: string;
  /** No hardpoint on this chassis is built to take it. */
  unmountable?: boolean;
  /** How many the company has spare, when the bay is working from stores. */
  stock?: number;
  onInspect: (payload: DropPayload) => void;
  onArm: (payload: DropPayload) => void;
  /** True while this entry is the one waiting to be placed. */
  armed?: boolean;
}) {
  const exhausted = stock !== undefined && stock <= 0;
  return (
    <li
      draggable={!exhausted}
      className={`bay-stock${unmountable ? ' unmountable' : ''}${exhausted ? ' exhausted' : ''}${armed ? ' armed' : ''}`}
      title={
        unmountable
          ? `${note ?? ''}\nNo hardpoint on this chassis takes one.`.trim()
          : exhausted
            ? `${note ?? ''}\nNone left in stores.`.trim()
            : note
      }
      data-testid={`stock-${payload.kind}-${payload.id}`}
      onClick={() => {
        onInspect(payload);
        if (!exhausted) onArm(payload);
      }}
      onDragStart={(event) => {
        onInspect(payload);
        event.dataTransfer.setData('application/ironline', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <span className="stock-name">
        {label}
        {stock === undefined ? null : <em className="stock-count">×{stock}</em>}
      </span>
      <span className="stock-detail">{detail}</span>
    </li>
  );
}

/** A labelled bar: what is spent, out of what there is. */
function Gauge({
  label,
  used,
  total,
  value,
  tone = 'ok',
  testId,
}: {
  label: string;
  used: number;
  total: number;
  value: string;
  tone?: 'ok' | 'warn' | 'over';
  testId?: string;
}) {
  const fraction = total <= 0 ? 0 : Math.max(0, Math.min(1, used / total));
  return (
    <div className={`bay-gauge ${tone}`}>
      <span className="gauge-label">{label}</span>
      <span className="gauge-value" data-testid={testId}>
        {value}
      </span>
      <span className="gauge-track">
        <span style={{ width: `${fraction * 100}%` }} />
      </span>
    </div>
  );
}

export function Mechbay({
  onExit,
  commission,
}: {
  onExit: () => void;
  commission?: BayCommission;
}) {
  const [design, setDesign] = useState<Design>(() =>
    JSON.parse(
      JSON.stringify(commission?.design ?? catalog.designs.get('sentinel_brawler')),
    ) as Design,
  );
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [stored, setStored] = useState<string[]>(() => listStoredDesigns());
  const [shelf, setShelf] = useState<Shelf>('weapons');
  const [inspected, setInspected] = useState<Inspected | null>(null);
  // What the player has picked up and not yet placed. Drag-and-drop is a mouse
  // gesture that HTML5 never gave touch screens, so the bay is also
  // pick-then-place: tap a shelf entry to take it, tap a location to fit it.
  const [armed, setArmed] = useState<DropPayload | null>(null);
  // Guns the hull cannot mount anywhere are hidden by default: on a light
  // chassis they were most of the list. The toggle brings them back for
  // window-shopping.
  const [showAll, setShowAll] = useState(false);

  const chassis = catalog.chassis.get(design.chassisId);
  const loadout = useMemo(() => computeLoadout(catalog, design), [design]);
  const heat = useMemo(() => computeHeatProfile(catalog, design), [design]);
  // The loadout rules are not the whole story — a blank name passes them and
  // then writes a file that will not load back. Gate on everything saving
  // checks, so the button state matches what the button will actually do.
  const issues = useMemo(() => designIssues(catalog, design), [design]);
  const saveable = issues.length === 0;
  const armourMax = useMemo(() => {
    const chassisFor = catalog.chassis.get(design.chassisId);
    if (chassisFor === undefined) return 0;
    return LOCATIONS.reduce((total, location) => total + chassisFor.armourMax[location], 0);
  }, [design.chassisId]);

  if (chassis === undefined) return <div className="bay">unknown chassis {design.chassisId}</div>;

  const apply = (next: Design): void => {
    setDesign(next);
    setStatus(null);
  };

  const onDrop = (payload: DropPayload, location: MechLocation): void => {
    setArmed(null);
    if (payload.kind === 'weapon') {
      // An ammo-fed gun arrives with a ton of ammunition, because a gun with
      // an empty bin is the trap every new player walks into once. More tons
      // come from the Ammo shelf; taking the gun off takes its ammo with it.
      let next = addMount(design, payload.id, location);
      if (catalog.weapons.get(payload.id)?.ammoPerTon != null) {
        next = addAmmo(next, payload.id, location);
      }
      apply(next);
    } else if (payload.kind === 'ammo') apply(addAmmo(design, payload.id, location));
    else apply(addEquipment(design, payload.id, location));
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
    setDesign(result.design);
    setStatus({ tone: 'ok', text: `Imported "${result.design.name}".` });
  };

  /** What is on the shelves: the whole catalogue, or what the company owns. */
  const inventory = commission?.inventory;
  const spare = (id: string): number | undefined => inventory?.get(id) ?? undefined;
  const onShelf = (id: string): boolean => inventory === undefined || (inventory.get(id) ?? 0) > 0;

  const weapons = [...catalog.weapons.values()].filter((weapon) => onShelf(weapon.id));
  const gear = [...catalog.equipment.values()].filter(
    (entry) => entry.category !== 'heat_sink' && onShelf(entry.id),
  );

  const overweight = loadout.freeTonnage < 0;

  return (
    <div className="bay" data-testid="mechbay">
      <header className="bay-top">
        {commission === undefined ? (
          <>
            <input
              className="bay-name"
              value={design.name}
              onChange={(event) => apply(setName(design, event.target.value))}
              data-testid="design-name"
            />
            <select
              // Renaming forks the design off the stock list, so the picker
              // needs somewhere to sit that is not one of the factory builds.
              value={catalog.designs.has(design.id) ? design.id : ''}
              onChange={(event) => {
                const picked = catalog.designs.get(event.target.value);
                if (picked !== undefined) apply(JSON.parse(JSON.stringify(picked)) as Design);
              }}
              data-testid="design-picker"
            >
              {catalog.designs.has(design.id) ? null : (
                <option value="">{design.name} (custom)</option>
              )}
              {/* Mechs only: the bay outfits what the company can drop. */}
              {[...catalog.designs.values()]
                .filter((entry) => catalog.chassis.get(entry.chassisId)?.frame === 'mech')
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </>
        ) : (
          <span className="bay-commission" data-testid="bay-commission">
            Refit — {commission.title}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            const factory = [...catalog.designs.values()].find(
              (entry) => entry.chassisId === design.chassisId,
            );
            if (factory !== undefined) {
              apply(JSON.parse(JSON.stringify(factory)) as Design);
              setStatus({ tone: 'ok', text: `Back to the stock ${factory.name} loadout.` });
            }
          }}
          title="Put the factory loadout back. Undoes every change on the gantry — a safe base to experiment from."
          data-testid="bay-reset-stock"
        >
          Reset to stock
        </button>
        <button
          type="button"
          onClick={commission === undefined ? onExit : commission.onCancel}
          data-testid="bay-exit"
        >
          {commission === undefined ? 'Back to skirmish' : 'Back to manifest'}
        </button>
      </header>

      {/* ------------------------------------------------------ the machine */}
      <section className="bay-machine" data-testid="bay-budget">
        <h3>
          {chassis.name}
          <span className="dossier-class">
            {chassis.class} · {chassis.tonnage}t ·{' '}
            {(
              (chassis.engineRating / chassis.tonnage) *
              catalog.rules.movement.walkSpeedFactor
            ).toFixed(0)}
            m/s
          </span>
        </h3>

        <ChassisSilhouette chassis={chassis} design={design} />

        <div className="bay-gauges">
          <Gauge
            label="Tonnage free"
            used={loadout.usedWeight}
            total={chassis.tonnage}
            value={`${loadout.freeTonnage.toFixed(1)}t`}
            tone={overweight ? 'over' : loadout.freeTonnage < 1 ? 'warn' : 'ok'}
            testId="free-tonnage"
          />
          <Gauge
            label="Slots"
            used={loadout.totalSlotsUsed}
            total={loadout.totalSlotsAvailable}
            value={`${loadout.totalSlotsUsed}/${loadout.totalSlotsAvailable}`}
            tone={loadout.totalSlotsUsed > loadout.totalSlotsAvailable ? 'over' : 'ok'}
          />
          <Gauge
            label="Heat"
            used={heat.heatPerSecond}
            total={Math.max(heat.heatPerSecond, heat.dissipationPerSecond)}
            value={
              heat.sustainable
                ? 'Sustainable'
                : `${(heat.secondsToShutdownRisk ?? 0).toFixed(0)}s to risk`
            }
            tone={heat.sustainable ? 'ok' : 'warn'}
            testId="heat-verdict"
          />
        </div>

        <dl className="bay-heat" data-testid="bay-heat">
          <div>
            <dt>Alpha strike</dt>
            <dd data-testid="heat-alpha">
              {heat.alphaStrikeHeat.toFixed(0)} of {heat.heatCapacity.toFixed(0)}
            </dd>
          </div>
          <div>
            <dt>Sustained</dt>
            <dd data-testid="heat-sustained">{heat.heatPerSecond.toFixed(2)}/s</dd>
          </div>
          <div>
            <dt>Dissipation</dt>
            <dd>{heat.dissipationPerSecond.toFixed(2)}/s</dd>
          </div>
        </dl>

        <div className="bay-controls">
          <label className="bay-sinks">
            Heat sinks
            <input
              type="number"
              min={chassis.internalHeatSinks}
              max={40}
              value={design.heatSinks}
              onChange={(event) => apply(setHeatSinks(design, Number(event.target.value)))}
              data-testid="heat-sink-count"
            />
            <select
              value={design.heatSinkId}
              onChange={(event) => apply(setHeatSinkId(design, event.target.value))}
              data-testid="heat-sink-type"
            >
              {[...catalog.equipment.values()]
                .filter((entry) => entry.category === 'heat_sink')
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => apply(fitCooling(catalog, design))}
              title="Set the sinks sustained fire needs"
              data-testid="fit-cooling"
            >
              Fit
            </button>
          </label>

          {/* One armour control for the whole machine. Eight per-location
              sliders were most of what made the bay read as paperwork, and
              nearly every build spreads armour evenly anyway. */}
          <label className="bay-armour-total">
            <span>
              Armour {loadout.armourPoints}/{armourMax}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((armourMax === 0 ? 0 : loadout.armourPoints / armourMax) * 100)}
              onChange={(event) =>
                apply(spreadArmour(catalog, design, Number(event.target.value) / 100))
              }
              data-testid="armour-total"
            />
          </label>
          <button
            type="button"
            onClick={() => apply(maximiseArmour(catalog, design))}
            data-testid="max-armour"
          >
            Spend rest on armour
          </button>

          <details className="bay-armour-detail" data-testid="armour-detail">
            <summary>Armour by location</summary>
            {LOCATIONS.map((location) => (
              <label key={location} className="bay-armour-row">
                <span>
                  {location.replace('_', ' ')} {design.armour[location]}/
                  {chassis.armourMax[location]}
                </span>
                <input
                  type="range"
                  min={0}
                  max={chassis.armourMax[location]}
                  value={design.armour[location]}
                  onChange={(event) => apply(setArmour(design, location, Number(event.target.value)))}
                  data-testid={`armour-${location}`}
                />
              </label>
            ))}
          </details>
        </div>

        {chassis.traits.length === 0 ? null : (
          <ul className="dossier-traits">
            {chassis.traits.map((traitId) => {
              const trait = catalog.rules.traits.entries[traitId];
              if (trait === undefined) return null;
              return (
                <li key={traitId} title={trait.note}>
                  {trait.label}
                </li>
              );
            })}
          </ul>
        )}
        <p className="dossier-summary" title={chassis.lore}>
          {chassis.summary}
        </p>

        <ul className="bay-issues" data-testid="bay-issues">
          {loadout.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              {issue.location === null ? '' : `${issue.location.replace('_', ' ')}: `}
              {issue.message}
            </li>
          ))}
          {issues.slice(loadout.issues.length).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------ the loadout */}
      <section className="bay-grid" data-testid="bay-grid">
        {armed === null ? null : (
          <div className="bay-armed-banner" data-testid="bay-armed">
            <span>
              Holding{' '}
              <strong>
                {armed.kind === 'equipment'
                  ? (catalog.equipment.get(armed.id)?.name ?? armed.id)
                  : `${catalog.weapons.get(armed.id)?.name ?? armed.id}${armed.kind === 'ammo' ? ' ammo' : ''}`}
              </strong>{' '}
              — tap a location to fit it.
            </span>
            <button type="button" onClick={() => setArmed(null)} data-testid="bay-armed-cancel">
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
            onRemoveMount={(index) => apply(removeMount(design, index))}
            onRemoveAmmo={(index) => apply(removeAmmo(design, index))}
            onRemoveEquipment={(index) => apply(removeEquipment(design, index))}
            onInspect={setInspected}
            armed={armed}
          />
        ))}
      </section>

      {/* ------------------------------------------------------- the stores */}
      <section className="bay-side">
        {/* One grid row: the shelf header. The column's rows are positional
            (header, scrolling stocks, dossier), so everything above the list
            has to live in one container. */}
        <div className="bay-shelf-head">
          <div className="bay-shelf-tabs" role="tablist">
            {(['weapons', 'ammo', 'equipment'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={shelf === tab}
                className={shelf === tab ? 'active' : ''}
                onClick={() => setShelf(tab)}
                data-testid={`shelf-${tab}`}
              >
                {tab}
              </button>
            ))}
          </div>
          {shelf !== 'weapons' ? null : (
            <label className="bay-show-all">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
                data-testid="shelf-show-all"
              />
              Show weapons this hull cannot mount
            </label>
          )}
        </div>

        <ul className="bay-stocks">
          {shelf === 'weapons'
            ? weapons.map((weapon) => {
                // Which hardpoints on this hull could take it at all.
                const size = weaponSize(catalog, weapon);
                const fits = LOCATIONS.some(
                  (location) =>
                    chassis.hardpoints[location][weapon.type] > 0 &&
                    chassis.hardpoints[location].size >= size,
                );
                if (!fits && !showAll) return null;
                return (
                  <Draggable
                    key={weapon.id}
                    payload={{ kind: 'weapon', id: weapon.id }}
                    label={weapon.name}
                    detail={`${weaponSizeLabel(catalog, size)} · ${weapon.tonnage}t · ${weapon.slots} slots · ${Math.round(weapon.damage * weapon.projectiles)} dmg · ${weapon.range.long}m`}
                    note={weapon.summary}
                    unmountable={!fits}
                    {...(spare(weapon.id) === undefined ? {} : { stock: spare(weapon.id) })}
                    onInspect={setInspected}
                    onArm={setArmed}
                    armed={armed?.kind === 'weapon' && armed.id === weapon.id}
                  />
                );
              })
            : null}

          {shelf === 'ammo'
            ? [...catalog.weapons.values()]
                .filter((weapon) => weapon.ammoPerTon !== null)
                .map((weapon) => (
                  <Draggable
                    key={weapon.id}
                    payload={{ kind: 'ammo', id: weapon.id }}
                    label={`${weapon.name} ammo`}
                    detail={`1t · ${weapon.ammoPerTon} rounds`}
                    note={weapon.summary}
                    onInspect={setInspected}
                    onArm={setArmed}
                    armed={armed?.kind === 'ammo' && armed.id === weapon.id}
                  />
                ))
            : null}

          {shelf === 'equipment'
            ? gear.map((entry) => (
                <Draggable
                  key={entry.id}
                  payload={{ kind: 'equipment', id: entry.id }}
                  label={entry.name}
                  detail={`${entry.tonnage}t · ${entry.slots} slots`}
                  {...(spare(entry.id) === undefined ? {} : { stock: spare(entry.id) })}
                  onInspect={setInspected}
                  onArm={setArmed}
                  armed={armed?.kind === 'equipment' && armed.id === entry.id}
                />
              ))
            : null}
        </ul>

        <Dossier catalog={catalog} inspected={inspected} heatSinkId={design.heatSinkId} />
      </section>

      <footer className="bay-actions">
        <button
          type="button"
          onClick={onSave}
          disabled={!saveable}
          title={saveable ? 'Save this build' : 'Fix the build before saving'}
          data-testid="bay-save"
        >
          {commission === undefined ? 'Save build' : 'Commit refit'}
        </button>

        {commission === undefined ? (
          <>
            <button type="button" onClick={onExport} disabled={!saveable} data-testid="bay-export">
              Export JSON
            </button>
            <label className="bay-import">
              Import JSON
              <input
                type="file"
                accept="application/json"
                data-testid="bay-import"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void onImport(file);
                }}
              />
            </label>
            <select
              value=""
              onChange={(event) => {
                if (event.target.value === '') return;
                const result = loadFromStorage(event.target.value);
                if (result.design === null) {
                  setStatus({ tone: 'error', text: result.error ?? 'load failed' });
                  return;
                }
                setDesign(result.design);
                setStatus({ tone: 'ok', text: `Loaded "${result.design.name}".` });
              }}
              data-testid="bay-stored"
            >
              <option value="">Saved builds…</option>
              {stored.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <span className={`bay-status ${status?.tone ?? ''}`} data-testid="bay-status" role="status">
          {status?.text ?? (saveable ? 'Build is legal.' : 'Build is not legal.')}
        </span>
      </footer>
    </div>
  );
}
