import type { UnitSnapshot, WeaponSnapshot } from './store';

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
              {mounted.map((weapon) => (
                <li key={weapon.index} className={weapon.destroyed ? 'destroyed' : ''}>
                  <CooldownRing weapon={weapon} />
                  <span className="weapon-name">{weapon.name}</span>
                  <span className="weapon-ammo">
                    {weapon.destroyed ? 'wrecked' : weapon.rounds === null ? '—' : weapon.rounds}
                  </span>
                </li>
              ))}
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
