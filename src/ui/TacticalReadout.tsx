import type { UnitSnapshot } from './store';
import { actionStatus, formatReadoutSeconds } from './combatTelemetry';

function Stability({ unit }: { unit: UnitSnapshot }) {
  const value = unit.stability.value;
  const capacity = unit.stability.knockdownAt;
  const fraction = capacity === 0 ? 0 : Math.min(1, value / capacity);
  const marker = capacity === 0 ? 0 : unit.stability.staggerAt / capacity;
  const state =
    unit.downRemaining > 0
      ? `DOWN ${formatReadoutSeconds(unit.downRemaining)}`
      : unit.stability.footingRemaining > 0
        ? `FOOTING ${formatReadoutSeconds(unit.stability.footingRemaining)}`
        : value >= unit.stability.staggerAt
          ? 'STAGGERED'
          : value > 0
            ? 'UNSTEADY'
            : 'STABLE';
  const tone = value >= unit.stability.staggerAt ? 'danger' : value > 0 ? 'warn' : 'ok';

  return (
    <div className="tactical-row" data-testid="stability-readout">
      <span className="tactical-label">Stability</span>
      <span className={`tactical-state ${tone}`}>{state}</span>
      <span className="stability-track">
        <span className={`stability-fill ${tone}`} style={{ width: `${fraction * 100}%` }} />
        <span className="stability-mark" style={{ left: `${marker * 100}%` }} />
      </span>
      <span className="tactical-number">
        {Math.round(value)}/{Math.round(capacity)}
      </span>
    </div>
  );
}

function Governor({ unit }: { unit: UnitSnapshot }) {
  const reactor = unit.reactor;
  const status = !unit.heatSafety
    ? 'OFF — weapons free'
    : reactor.shedGroups.length > 0
      ? `SHEDDING G${reactor.shedGroups.join(' G')}`
      : `ARMED AT ${Math.round(reactor.governorHoldAt * 100)}%`;

  return (
    <div
      className="governor-line"
      title={`The governor resumes every requested group below ${Math.round(reactor.governorResumeAt * 100)}% heat.`}
      data-testid="governor-readout"
    >
      <span className="tactical-label">Governor</span>
      <strong className={reactor.shedGroups.length > 0 ? 'warn' : ''}>{status}</strong>
    </div>
  );
}

export function TacticalReadout({ unit }: { unit: UnitSnapshot }) {
  return (
    <section className="tactical-readout" data-testid="tactical-readout">
      <div className="ability-readout" title={unit.ability.note}>
        <span className="tactical-label">Pilot ability</span>
        <strong>{unit.ability.label}</strong>
        <span className="tactical-state">{actionStatus(unit.ability)}</span>
        <p>{unit.ability.note}</p>
      </div>
      <Stability unit={unit} />
      <div className="tactical-row alpha-readout" title={unit.alpha.note} data-testid="alpha-readout">
        <span className="tactical-label">Next alpha</span>
        <span className="tactical-state">{actionStatus(unit.alpha)}</span>
        <strong>
          +{Math.round(unit.reactor.alphaHeat)} →{' '}
          {Math.round(unit.reactor.projectedFraction * 100)}%
        </strong>
        <span className={`alpha-band ${unit.reactor.projectedTone}`}>
          {unit.reactor.projectedBand}
        </span>
        <span className="alpha-caveat">If every gun bears; cooling is not credited.</span>
      </div>
      <Governor unit={unit} />
    </section>
  );
}
