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
  removeMount,
  saveToStorage,
  setArmour,
  setHeatSinkId,
  setHeatSinks,
  setName,
} from './editor';
import { ChassisSilhouette } from './ChassisSilhouette';
import { LocationCard, type DropPayload } from './LocationCard';

const catalog = getCatalog();

function Draggable({
  payload,
  label,
  detail,
  note,
  unmountable = false,
}: {
  payload: DropPayload;
  label: string;
  detail: string;
  note?: string;
  /** No hardpoint on this chassis is built to take it. */
  unmountable?: boolean;
}) {
  return (
    <li
      draggable
      className={`bay-stock${unmountable ? ' unmountable' : ''}`}
      title={unmountable ? `${note ?? ''}\nNo hardpoint on this chassis takes one.`.trim() : note}
      data-testid={`stock-${payload.kind}-${payload.id}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/ironline', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <span className="stock-name">{label}</span>
      <span className="stock-detail">{detail}</span>
      {note === undefined ? null : <span className="stock-note">{note}</span>}
    </li>
  );
}

export function Mechbay({ onExit }: { onExit: () => void }) {
  const startingId = 'sentinel_brawler';
  const [design, setDesign] = useState<Design>(
    () => JSON.parse(JSON.stringify(catalog.designs.get(startingId))) as Design,
  );
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [stored, setStored] = useState<string[]>(() => listStoredDesigns());

  const chassis = catalog.chassis.get(design.chassisId);
  const loadout = useMemo(() => computeLoadout(catalog, design), [design]);
  const heat = useMemo(() => computeHeatProfile(catalog, design), [design]);
  // The loadout rules are not the whole story — a blank name passes them and
  // then writes a file that will not load back. Gate on everything saving
  // checks, so the button state matches what the button will actually do.
  const issues = useMemo(() => designIssues(catalog, design), [design]);
  const saveable = issues.length === 0;

  if (chassis === undefined) return <div className="bay">unknown chassis {design.chassisId}</div>;

  const apply = (next: Design): void => {
    setDesign(next);
    setStatus(null);
  };

  const onDrop = (payload: DropPayload, location: MechLocation): void => {
    if (payload.kind === 'weapon') apply(addMount(design, payload.id, location));
    else if (payload.kind === 'ammo') apply(addAmmo(design, payload.id, location));
    else apply(addEquipment(design, payload.id, location));
  };

  const onSave = (): void => {
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
      const blob = exportDesign(catalog, design);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${design.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({ tone: 'ok', text: `Exported ${design.id}.json` });
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
      setStatus({ tone: 'error', text: `Cannot load — ${result.error ?? 'unreadable'}` });
      return;
    }
    setDesign(result.design);
    setStatus({ tone: 'ok', text: `Loaded "${result.design.name}".` });
  };

  const weightRows: [string, number][] = [
    ['Engine', loadout.engineWeight],
    ['Structure', loadout.structureWeight],
    ['Armour', loadout.armourWeight],
    ['Heat sinks', loadout.heatSinkWeight],
    ['Payload', loadout.payloadWeight],
  ];

  return (
    <div className="bay" data-testid="mechbay">
      <header className="bay-top">
        <input
          className="bay-name"
          value={design.name}
          onChange={(event) => apply(setName(design, event.target.value))}
          data-testid="design-name"
        />
        <select
          // Renaming forks the design off the stock list, so the picker needs
          // somewhere to sit that is not one of the factory builds.
          value={catalog.designs.has(design.id) ? design.id : ''}
          onChange={(event) => {
            const picked = catalog.designs.get(event.target.value);
            if (picked !== undefined) apply(JSON.parse(JSON.stringify(picked)) as Design);
          }}
          data-testid="design-picker"
        >
          {catalog.designs.has(design.id) ? null : <option value="">{design.name} (custom)</option>}
          {[...catalog.designs.values()].map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={onExit} data-testid="bay-exit">
          Back to skirmish
        </button>
      </header>

      <section className="bay-budget" data-testid="bay-budget">
        <h3>
          {chassis.name} — {chassis.tonnage}t
        </h3>
        <table>
          <tbody>
            {weightRows.map(([label, tons]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{tons.toFixed(1)}t</td>
              </tr>
            ))}
            <tr className={loadout.freeTonnage < 0 ? 'over' : 'free'}>
              <th>Free</th>
              <td data-testid="free-tonnage">{loadout.freeTonnage.toFixed(1)}t</td>
            </tr>
          </tbody>
        </table>

        <div className="bay-slot-total">
          Slots {loadout.totalSlotsUsed}/{loadout.totalSlotsAvailable}
        </div>

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
        </label>

        <button
          type="button"
          onClick={() => apply(maximiseArmour(catalog, design))}
          data-testid="max-armour"
        >
          Spend rest on armour
        </button>

        <ul className="bay-issues" data-testid="bay-issues">
          {loadout.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              {issue.location === null ? '' : `${issue.location}: `}
              {issue.message}
            </li>
          ))}
          {issues.slice(loadout.issues.length).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </section>

      <section className="bay-dossier" data-testid="bay-dossier">
        <h4>
          {chassis.name}
          <span className="dossier-class">
            {chassis.class} · {chassis.tonnage}t · {(
              (chassis.engineRating / chassis.tonnage) *
              catalog.rules.movement.walkSpeedFactor
            ).toFixed(0)}
            m/s
          </span>
        </h4>
        <ChassisSilhouette chassis={chassis} design={design} />
        <p className="dossier-summary">{chassis.summary}</p>
        <p className="dossier-lore">{chassis.lore}</p>
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
      </section>

      <section className="bay-grid" data-testid="bay-grid">
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
            onArmourChange={(where, value) => apply(setArmour(design, where, value))}
          />
        ))}
      </section>

      <section className="bay-side">
        <div className="bay-heat" data-testid="bay-heat">
          <h4>Heat efficiency</h4>
          <dl>
            <dt>Alpha strike</dt>
            <dd data-testid="heat-alpha">
              {heat.alphaStrikeHeat.toFixed(0)} of {heat.heatCapacity.toFixed(0)}
            </dd>
            <dt>Sustained</dt>
            <dd data-testid="heat-sustained">{heat.heatPerSecond.toFixed(2)}/s</dd>
            <dt>Dissipation</dt>
            <dd>{heat.dissipationPerSecond.toFixed(2)}/s</dd>
            <dt>Verdict</dt>
            <dd className={heat.sustainable ? 'ok' : 'warn'} data-testid="heat-verdict">
              {heat.sustainable
                ? 'Sustainable'
                : `Shutdown risk after ${(heat.secondsToShutdownRisk ?? 0).toFixed(1)}s`}
            </dd>
          </dl>
          <div className="heat-meter">
            <span style={{ width: `${Math.min(100, heat.sustainableFraction * 100)}%` }} />
          </div>
          <small>{Math.round(heat.sustainableFraction * 100)}% of full rate is sustainable</small>
        </div>

        <h4>Weapons</h4>
        <ul className="bay-stocks">
          {[...catalog.weapons.values()].map((weapon) => {
            // Which hardpoints on this hull could take it at all. A gun the
            // machine cannot mount anywhere is worth saying so before the
            // player spends an afternoon budgeting tonnage for it.
            const size = weaponSize(catalog, weapon);
            const fits = LOCATIONS.some(
              (location) =>
                chassis.hardpoints[location][weapon.type] > 0 &&
                chassis.hardpoints[location].size >= size,
            );
            return (
              <Draggable
                key={weapon.id}
                payload={{ kind: 'weapon', id: weapon.id }}
                label={weapon.name}
                detail={`${weaponSizeLabel(catalog, size)} · ${weapon.tonnage}t · ${weapon.slots} slots · ${weapon.heat} heat · ${weapon.range.long}m`}
                note={weapon.summary}
                unmountable={!fits}
              />
            );
          })}
        </ul>

        <h4>Ammo</h4>
        <ul className="bay-stocks">
          {[...catalog.weapons.values()]
            .filter((weapon) => weapon.ammoPerTon !== null)
            .map((weapon) => (
              <Draggable
                key={weapon.id}
                payload={{ kind: 'ammo', id: weapon.id }}
                label={`${weapon.name} ammo`}
                detail={`1t · ${weapon.ammoPerTon} rounds`}
              />
            ))}
        </ul>

        <h4>Equipment</h4>
        <ul className="bay-stocks">
          {[...catalog.equipment.values()]
            .filter((entry) => entry.category !== 'heat_sink')
            .map((entry) => (
              <Draggable
                key={entry.id}
                payload={{ kind: 'equipment', id: entry.id }}
                label={entry.name}
                detail={`${entry.tonnage}t · ${entry.slots} slots`}
              />
            ))}
        </ul>
      </section>

      <footer className="bay-actions">
        <button
          type="button"
          onClick={onSave}
          disabled={!saveable}
          title={saveable ? 'Save to browser storage' : 'Fix the build before saving'}
          data-testid="bay-save"
        >
          Save build
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={!saveable}
          data-testid="bay-export"
        >
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

        <span
          className={`bay-status ${status?.tone ?? ''}`}
          data-testid="bay-status"
          role="status"
        >
          {status?.text ?? (saveable ? 'Build is legal.' : 'Build is not legal.')}
        </span>
      </footer>
    </div>
  );
}
