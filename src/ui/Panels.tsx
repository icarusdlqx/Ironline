import type { HitPreviewView, UnitSnapshot, WeaponSnapshot } from './store';
import type { SupportOption } from './supportOptions';

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

/** What a gun that cannot fire says instead of a number. */
const BLOCK_LABELS: Record<string, string> = {
  destroyed: '',
  ammo: 'dry',
  range: 'too far',
  sight: 'no sight',
  arc: 'off arc',
};

export function WeaponGroups({
  unit,
  onToggleGroup,
  preview,
}: {
  unit: UnitSnapshot;
  onToggleGroup: (group: number) => void;
  preview?: HitPreviewView;
}) {
  const groups = [1, 2, 3, 4];
  const previewByIndex = new Map(
    (preview?.weapons ?? []).map((entry) => [entry.index, entry]),
  );

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
                    {(() => {
                      if (preview === undefined) return null;
                      const priced = previewByIndex.get(weapon.index);
                      if (priced === undefined || weapon.destroyed) return null;
                      if (priced.chance !== null) {
                        const percent = Math.round(priced.chance * 100);
                        const grade = percent >= 60 ? 'good' : percent >= 30 ? 'fair' : 'poor';
                        return (
                          <span className={`weapon-hit ${grade}`} data-testid={`tohit-${weapon.index}`}>
                            {percent}%
                          </span>
                        );
                      }
                      const label = BLOCK_LABELS[priced.blocked ?? ''] ?? '';
                      return label === '' ? null : (
                        <span className="weapon-hit blocked">{label}</span>
                      );
                    })()}
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
          (sum, location) => sum + location.armour + location.rearArmour + location.internal,
          0,
        );
        const max = Object.values(unit.locations).reduce(
          (sum, location) =>
            sum + location.armourMax + location.rearArmourMax + location.internalMax,
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
                ? unit.downRemaining > 0
                  ? 'DOWN'
                  : unit.shutdownRemaining > 0
                    ? 'SHUTDOWN'
                    : unit.staggered
                      ? 'STAGGERED'
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

export function SupportPalette({
  options,
  resourcePoints,
  active,
  reservesLeft,
  onPick,
}: {
  options: readonly SupportOption[];
  resourcePoints: number;
  active: SupportOption['id'] | null;
  reservesLeft: number;
  onPick: (call: SupportOption['id']) => void;
}) {
  return (
    <div className="support" data-testid="support-palette">
      <span className="rp" data-testid="resource-points">
        {resourcePoints} RP
      </span>
      {options.map((option) => {
        const unaffordable = resourcePoints < option.cost;
        const noReserves = option.id === 'reinforcement' && reservesLeft === 0;
        const status = noReserves
          ? 'No mission reserve remains.'
          : unaffordable
            ? `${option.cost - resourcePoints} RP short.`
            : active === option.id
              ? `Armed · ${option.placement}`
              : option.placement;
        return (
          <button
            key={option.id}
            type="button"
            className={`support-call ${active === option.id ? 'active' : ''}`}
            disabled={unaffordable || noReserves}
            title={status}
            onClick={() => onPick(option.id)}
            data-testid={`support-${option.id}`}
          >
            <span className="support-call-head">
              <span className="support-label">{option.label}</span>
              <span className="support-cost">{option.cost} RP</span>
            </span>
            <span className="support-effect">{option.effect}</span>
            <span className="support-placement">{status}</span>
          </button>
        );
      })}
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
          (total, part) => total + part.armour + part.rearArmour + part.internal,
          0,
        );
        const intact = Object.values(enemy.locations).reduce(
          (total, part) => total + part.armourMax + part.rearArmourMax + part.internalMax,
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
