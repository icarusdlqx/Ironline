import type { MechLocation } from '../schema/common';
import type { Engine } from './engine';
import { EventLog, HeatBar, WeaponGroups } from './Panels';
import { PaperDoll } from './PaperDoll';
import { selectedUnit, useGame } from './store';
import { TacticalReadout } from './TacticalReadout';

export function UnitPanel({ engine, compact = false }: { engine: Engine | null; compact?: boolean }) {
  const state = useGame();
  const unit = selectedUnit(state);
  const preview =
    unit !== null && state.hitPreview !== null && state.hitPreview.shooterId === unit.id
      ? state.hitPreview
      : null;
  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;

  const onSelectLocation = (location: MechLocation): void => {
    state.setCalledShotLocation(location);
    state.setOrderMode('called_shot');
  };

  return (
    <aside
      className={compact ? 'mobile-unit-panel' : 'sidebar'}
      data-testid={compact ? 'mobile-unit-panel' : 'sidebar'}
    >
      {unit === null ? (
        <p className="empty">
          {compact ? 'Tap a mech or choose it from the lance.' : 'Select a mech — click it, or press Tab to cycle your lance.'}
        </p>
      ) : (
        <>
          <h2>
            {unit.pilotName}
            <small>{unit.name}</small>
          </h2>
          <PaperDoll
            locations={unit.locations}
            {...(playerControlled ? { onSelectLocation } : {})}
            activeLocation={state.orderMode === 'called_shot' ? state.calledShotLocation : null}
          />
          <HeatBar heat={unit.heat} capacity={unit.heatCapacity} thresholds={state.heatTiers} />
          <TacticalReadout unit={unit} />
          <div className="target-line">
            {preview === null ? (
              <>
                Target: <strong>{unit.targetName ?? 'none'}</strong>
              </>
            ) : (
              <>
                {preview.hover ? 'Sizing up' : 'Target'}: <strong>{preview.targetName}</strong>
                <span className="target-range">{Math.round(preview.range)}m</span>
              </>
            )}
          </div>
          {preview === null || preview.factors.length === 0 ? null : (
            <div className="hit-factors" data-testid="hit-factors">
              {preview.factors.map((factor) => (
                <span
                  key={factor.id}
                  className={factor.value < 1 ? 'penalty' : 'bonus'}
                  title={`×${factor.value.toFixed(2)}`}
                >
                  {factor.label} {factor.value < 1 ? '−' : '+'}
                  {Math.abs(Math.round((factor.value - 1) * 100))}%
                </span>
              ))}
            </div>
          )}
          <WeaponGroups
            unit={unit}
            onToggleGroup={(group) => engine?.toggleGroup(group)}
            {...(preview === null ? {} : { preview })}
          />
        </>
      )}
      <EventLog lines={state.log} />
    </aside>
  );
}
