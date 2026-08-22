import type { Chassis } from '../../schema/chassis';
import { LOCATIONS, type MechLocation } from '../../schema/common';
import type { Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import type { HeatProfile, Loadout } from '../../sim/loadout';
import {
  fitCooling,
  maximiseArmour,
  setArmour,
  setHeatSinkId,
  setHeatSinks,
  spreadArmour,
} from './editor';
import { MechPreview } from './MechPreview';

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

interface Props {
  catalog: Catalog;
  chassis: Chassis;
  design: Design;
  loadout: Loadout;
  heat: HeatProfile;
  issues: readonly string[];
  selectedLocation: MechLocation | null;
  hoveredLocation: MechLocation | null;
  compatibleLocations: ReadonlySet<MechLocation>;
  heatSinkAvailable: (id: string) => boolean;
  onApply: (design: Design) => void;
  onSelectLocation: (location: MechLocation) => void;
  onHoverLocation: (location: MechLocation | null) => void;
}

export function MachinePanel({
  catalog,
  chassis,
  design,
  loadout,
  heat,
  issues,
  selectedLocation,
  hoveredLocation,
  compatibleLocations,
  heatSinkAvailable,
  onApply,
  onSelectLocation,
  onHoverLocation,
}: Props) {
  const armourMax = LOCATIONS.reduce(
    (total, location) => total + chassis.armourMax[location],
    0,
  );
  const overweight = loadout.freeTonnage < 0;
  return (
    <section className="bay-machine" data-testid="bay-budget">
      <h3>
        {chassis.name}
        <span className="dossier-class">
          {chassis.class} · {chassis.tonnage}t ·{' '}
          {(
            (chassis.engineRating / chassis.tonnage) *
            catalog.rules.movement.walkSpeedFactor
          ).toFixed(0)}
          m/s · {chassis.faction === 'aurelian' ? 'Aurelian Stock' : 'Linewrought'}
        </span>
      </h3>

      <MechPreview
        catalog={catalog}
        chassis={chassis}
        design={design}
        selected={selectedLocation}
        hovered={hoveredLocation}
        compatible={compatibleLocations}
        onHoverLocation={onHoverLocation}
        onSelectLocation={onSelectLocation}
      />
      <p className="bay-preview-help">Select a hardpoint on the machine or in the location grid.</p>

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
            onChange={(event) => onApply(setHeatSinks(design, Number(event.target.value)))}
            data-testid="heat-sink-count"
          />
          <select
            value={design.heatSinkId}
            onChange={(event) => onApply(setHeatSinkId(design, event.target.value))}
            data-testid="heat-sink-type"
          >
            {[...catalog.equipment.values()]
              .filter(
                (entry) =>
                  entry.category === 'heat_sink' &&
                  (entry.id === design.heatSinkId || heatSinkAvailable(entry.id)),
              )
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => onApply(fitCooling(catalog, design))}
            title="Set the sinks sustained fire needs"
            data-testid="fit-cooling"
          >
            Fit
          </button>
        </label>

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
              onApply(spreadArmour(catalog, design, Number(event.target.value) / 100))
            }
            data-testid="armour-total"
          />
        </label>
        <button
          type="button"
          onClick={() => onApply(maximiseArmour(catalog, design))}
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
                onChange={(event) =>
                  onApply(setArmour(design, location, Number(event.target.value)))
                }
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
            return trait === undefined ? null : (
              <li key={traitId} title={trait.note}>
                {trait.label}
              </li>
            );
          })}
        </ul>
      )}
      <p className="dossier-summary" title={chassis.lore}>{chassis.summary}</p>

      <ul className="bay-issues" data-testid="bay-issues">
        {loadout.issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>
            {issue.location === null ? '' : `${issue.location.replace('_', ' ')}: `}
            {issue.message}
          </li>
        ))}
        {issues.slice(loadout.issues.length).map((issue) => <li key={issue}>{issue}</li>)}
      </ul>
    </section>
  );
}
