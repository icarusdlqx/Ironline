import type { SupportCallId } from '../sim/support';
import type { ObjectiveView, UnitSnapshot, WeaponSnapshot, ZoneView } from './store';

export function HeatBar({
  heat,
  capacity,
  thresholds,
}: {
  heat: number;
  capacity: number;
  thresholds: readonly number[];
}) {
  const fraction = capacity === 0 ? 0 : Math.min(1.2, heat / capacity);
  const tone = fraction >= 1 ? 'critical' : fraction >= 0.85 ? 'danger' : fraction >= 0.5 ? 'warn' : 'ok';

  return (
    <div className="heat" data-testid="heat-bar">
      <div className="heat-track">
        <div className={`heat-fill ${tone}`} style={{ width: `${Math.min(100, fraction * 100)}%` }} />
        {thresholds
          .filter((threshold) => threshold > 0)
          .map((threshold) => (
            <span key={threshold} className="heat-mark" style={{ left: `${threshold * 100}%` }} />
          ))}
      </div>
      <span className="heat-value">
        {Math.round(heat)}/{Math.round(capacity)}
      </span>
    </div>
  );
}

function CooldownRing({ weapon }: { weapon: WeaponSnapshot }) {
  const ready = weapon.cooldownMax === 0 ? 1 : 1 - weapon.cooldown / weapon.cooldownMax;
  const degrees = Math.round(Math.max(0, Math.min(1, ready)) * 360);
  return (
    <span
      className="cooldown-ring"
      style={{
        background: `conic-gradient(var(--accent) ${degrees}deg, rgba(255,255,255,0.09) ${degrees}deg)`,
      }}
    />
  );
}

export function WeaponGroups({
  unit,
  onToggleGroup,
}: {
  unit: UnitSnapshot;
  onToggleGroup: (group: number) => void;
}) {
  const groups = [1, 2, 3, 4];

  return (
    <div className="weapons" data-testid="weapon-groups">
      {groups.map((group) => {
        const mounted = unit.weapons.filter((weapon) => weapon.group === group);
        if (mounted.length === 0) return null;
        const enabled = unit.groupEnabled[group - 1] === true;

        return (
          <div key={group} className={`weapon-group ${enabled ? '' : 'disabled'}`}>
            <button
              type="button"
              className="group-key"
              onClick={() => onToggleGroup(group)}
              title={`Toggle weapon group ${group}`}
              data-testid={`group-${group}`}
            >
              {group}
            </button>
            <ul>
              {mounted.map((weapon) => {
                const lost = unit.lostLocations.includes(weapon.location);
                const reach =
                  unit.targetRange === null
                    ? null
                    : unit.targetRange <= weapon.shortRange
                      ? 'short'
                      : unit.targetRange <= weapon.longRange
                        ? 'long'
                        : 'over';
                return (
                  <li
                    key={weapon.index}
                    className={weapon.destroyed ? 'destroyed' : reach === 'over' ? 'out-of-range' : ''}
                    title={
                      lost
                        ? `Lost with the ${weapon.location.replace(/_/g, ' ')}`
                        : `Short ${Math.round(weapon.shortRange)}m · reaches ${Math.round(weapon.longRange)}m`
                    }
                  >
                    <CooldownRing weapon={weapon} />
                    <span className="weapon-name">{weapon.name}</span>
                    <span className={`weapon-range ${reach ?? ''}`}>
                      {Math.round(weapon.longRange)}m
                    </span>
                    <span className="weapon-ammo">
                      {weapon.destroyed
                        ? lost
                          ? 'blown off'
                          : 'wrecked'
                        : weapon.rounds === null
                          ? '—'
                          : weapon.rounds}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function LanceBar({
  units,
  selection,
  onSelect,
}: {
  units: readonly UnitSnapshot[];
  selection: readonly number[];
  onSelect: (id: number) => void;
}) {
  return (
    <div className="lance" data-testid="lance-bar">
      {units.map((unit) => {
        const total = Object.values(unit.locations).reduce(
          (sum, location) => sum + location.armour + location.internal,
          0,
        );
        const max = Object.values(unit.locations).reduce(
          (sum, location) => sum + location.armourMax + location.internalMax,
          0,
        );
        const health = max === 0 ? 0 : total / max;

        return (
          <button
            key={unit.id}
            type="button"
            className={`lance-card ${selection.includes(unit.id) ? 'selected' : ''} ${unit.alive ? '' : 'dead'}`}
            onClick={() => onSelect(unit.id)}
            data-testid={`lance-card-${unit.id}`}
          >
            <span className="lance-name">{unit.pilotName}</span>
            <span className="lance-chassis">{unit.name}</span>
            <span className="lance-health">
              <span style={{ width: `${health * 100}%` }} />
            </span>
            <span className="lance-status">
              {unit.alive
                ? unit.shutdownRemaining > 0
                  ? 'SHUTDOWN'
                  : unit.holdingFire
                    ? 'HOLDING'
                    : unit.motion.toUpperCase()
                : (unit.killMethod ?? 'LOST').toUpperCase()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function EventLog({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="log" data-testid="event-log">
      {lines.slice(0, 8).map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

export function ObjectiveList({
  objectives,
  zones,
}: {
  objectives: readonly ObjectiveView[];
  zones: readonly ZoneView[];
}) {
  if (objectives.length === 0) return null;

  return (
    <div className="objectives" data-testid="objective-list">
      <h4>Objectives</h4>
      <ul>
        {objectives.map((objective) => (
          <li key={objective.id} className={objective.status} data-testid={`objective-${objective.id}`}>
            <span className="objective-mark">
              {objective.status === 'complete' ? '✓' : objective.status === 'failed' ? '✗' : '•'}
            </span>
            <span className="objective-label">
              {objective.label}
              {objective.required ? '' : ' (optional)'}
            </span>
            <span className="objective-progress">{Math.round(objective.progress * 100)}%</span>
          </li>
        ))}
      </ul>
      {zones.length === 0 ? null : (
        <ul className="zones" data-testid="zone-list">
          {zones.map((zone) => (
            <li key={zone.id} data-testid={`zone-${zone.id}`}>
              <span>{zone.name}</span>
              <span className={zone.owner === 0 ? 'held' : 'lost'}>
                {zone.contested
                  ? 'contested'
                  : zone.owner === 0
                    ? 'held'
                    : zone.contender === 0
                      ? `${Math.round((zone.progress / zone.captureSeconds) * 100)}%`
                      : 'enemy'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface SupportOption {
  id: SupportCallId;
  label: string;
  cost: number;
  hint: string;
}

export function SupportPalette({
  options,
  resourcePoints,
  active,
  reservesLeft,
  onPick,
}: {
  options: readonly SupportOption[];
  resourcePoints: number;
  active: SupportCallId | null;
  reservesLeft: number;
  onPick: (call: SupportCallId) => void;
}) {
  return (
    <div className="support" data-testid="support-palette">
      <span className="rp" data-testid="resource-points">
        {resourcePoints} RP
      </span>
      {options.map((option) => {
        const unaffordable = resourcePoints < option.cost;
        const noReserves = option.id === 'reinforcement' && reservesLeft === 0;
        return (
          <button
            key={option.id}
            type="button"
            className={`support-call ${active === option.id ? 'active' : ''}`}
            disabled={unaffordable || noReserves}
            title={noReserves ? 'The dropship has no reserves left' : `${option.hint} — ${option.cost} RP`}
            onClick={() => onPick(option.id)}
            data-testid={`support-${option.id}`}
          >
            <span className="support-label">{option.label}</span>
            <span className="support-cost">{option.cost}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One berth of the pre-battle lance, prepared by the caller. */
export interface BriefingBerth {
  index: number;
  /** The design select's current value: a design id, or 'custom'. */
  designValue: string;
  /** Shown for the custom option, so an edited build keeps its name. */
  customLabel: string | null;
  pilotId: string;
  tonnage: number;
}

export interface BriefingLance {
  berths: BriefingBerth[];
  designs: { value: string; label: string; tonnage: number }[];
  saved: { value: string; label: string }[];
  pilots: { id: string; name: string }[];
  total: number;
  allowance: number;
  onDesign: (index: number, value: string) => void;
  onPilot: (index: number, pilotId: string) => void;
  onCustomise: (index: number) => void;
}

export function Briefing({
  name,
  text,
  objectives,
  resourcePoints,
  lance,
  onDeploy,
}: {
  name: string;
  text: string;
  objectives: readonly ObjectiveView[];
  resourcePoints: number;
  /** Absent for campaign drops, whose lance the dropship manifest decided. */
  lance?: BriefingLance;
  onDeploy: () => void;
}) {
  const over = lance !== undefined && lance.total > lance.allowance;
  const taken = (pilotId: string): number =>
    lance === undefined ? 0 : lance.berths.filter((berth) => berth.pilotId === pilotId).length;

  return (
    <div className="briefing" data-testid="briefing">
      <h2>{name}</h2>
      <p>{text}</p>
      <h4>Objectives</h4>
      <ul>
        {objectives.map((objective) => (
          <li key={objective.id}>
            {objective.label}
            {objective.required ? '' : ' (optional)'}
          </li>
        ))}
      </ul>

      {lance === undefined ? null : (
        <div className="briefing-lance" data-testid="briefing-lance">
          <h4>
            Lance
            <span className={`briefing-tonnage${over ? ' over' : ''}`} data-testid="briefing-tonnage">
              {lance.total}/{lance.allowance}t
            </span>
          </h4>
          {lance.berths.map((berth) => (
            <div className="briefing-berth" key={berth.index}>
              <select
                value={berth.designValue}
                onChange={(event) => lance.onDesign(berth.index, event.target.value)}
                data-testid={`berth-design-${berth.index}`}
                aria-label={`Mech for berth ${berth.index + 1}`}
              >
                {berth.customLabel === null ? null : (
                  <option value="custom">{berth.customLabel} (custom)</option>
                )}
                {lance.designs.map((design) => (
                  <option key={design.value} value={design.value}>
                    {design.label} — {design.tonnage}t
                  </option>
                ))}
                {lance.saved.length === 0 ? null : (
                  <optgroup label="Saved builds">
                    {lance.saved.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <select
                value={berth.pilotId}
                onChange={(event) => lance.onPilot(berth.index, event.target.value)}
                data-testid={`berth-pilot-${berth.index}`}
                aria-label={`Pilot for berth ${berth.index + 1}`}
              >
                {lance.pilots.map((pilot) => (
                  <option
                    key={pilot.id}
                    value={pilot.id}
                    // The same person cannot fly two machines at once.
                    disabled={pilot.id !== berth.pilotId && taken(pilot.id) > 0}
                  >
                    {pilot.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => lance.onCustomise(berth.index)}
                title="Open the bay on this machine"
                data-testid={`berth-customise-${berth.index}`}
              >
                Customise
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="briefing-rp">{resourcePoints} Resource Points on the books.</p>
      <button
        type="button"
        onClick={onDeploy}
        disabled={over}
        title={over ? 'The lance is over the drop tonnage — lighten it first.' : undefined}
        data-testid="briefing-deploy"
      >
        {over ? 'Over tonnage' : 'Deploy'}
      </button>
    </div>
  );
}

/**
 * Every hostile the lance can see, as a list you can click.
 *
 * Picking a target by clicking the machine itself is the natural way to do it,
 * and it is also the way that fails first: a mech eight pixels tall at the far
 * end of the map, a trackpad with no second button, a browser that routes the
 * click somewhere unexpected. This is the same order, given from a list that is
 * always the same size and always in the same place.
 */
export function HostileBar({
  enemies,
  targetIds,
  hasSelection,
  onTarget,
}: {
  enemies: readonly UnitSnapshot[];
  /** Which hostiles the current selection is already shooting at. */
  targetIds: ReadonlySet<number>;
  hasSelection: boolean;
  onTarget: (id: number) => void;
}) {
  const standing = enemies.filter((enemy) => enemy.alive);

  return (
    <div className="hostiles" data-testid="hostile-bar">
      <span className="hostiles-label">
        {standing.length === 0 ? 'No contacts' : `Contacts ${standing.length}`}
      </span>
      {standing.map((enemy) => {
        const structure = Object.values(enemy.locations).reduce(
          (total, part) => total + part.armour + part.internal,
          0,
        );
        const intact = Object.values(enemy.locations).reduce(
          (total, part) => total + part.armourMax + part.internalMax,
          0,
        );
        const health = intact === 0 ? 0 : structure / intact;

        return (
          <button
            key={enemy.id}
            type="button"
            className={`hostile ${targetIds.has(enemy.id) ? 'targeted' : ''}${enemy.identified ? '' : ' unidentified'}`}
            disabled={!hasSelection}
            title={
              !enemy.identified
                ? 'Sensor contact — too far out to identify. Close on it, or send a scout.'
                : hasSelection
                  ? `Target ${enemy.name}`
                  : 'Select one of your mechs first, then click a contact to attack it'
            }
            onClick={() => onTarget(enemy.id)}
            data-testid={`hostile-${enemy.id}`}
          >
            {/* A contact the lance cannot name is a contact, not a chassis.
                Naming it anyway is free intelligence, and the reason nobody
                would ever bother fielding a scout. */}
            <span className="hostile-name">{enemy.identified ? enemy.name : 'Unknown contact'}</span>
            <span className="hostile-range">
              {enemy.rangeToLance === null ? '—' : `${Math.round(enemy.rangeToLance)}m`}
            </span>
            <span className="hostile-health">
              <span style={{ width: `${Math.round(health * 100)}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
