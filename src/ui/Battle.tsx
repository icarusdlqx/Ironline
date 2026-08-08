import { useEffect, useRef } from 'react';
import type { MechLocation } from '../schema/common';
import { CommandPalette, type Command } from './CommandPalette';
import { createEngine, type Engine } from './engine';
import { EventLog, HeatBar, LanceBar, WeaponGroups } from './Panels';
import { PaperDoll } from './PaperDoll';
import { selectedUnit, useGame } from './store';

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function Battle() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const state = useGame();
  const unit = selectedUnit(state);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let cancelled = false;
    createEngine(host)
      .then((engine) => {
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
      })
      .catch((error: unknown) => {
        useGame.getState().patch({ error: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const onCommand = (command: Command): void => {
    const engine = engineRef.current;
    if (engine === null) return;

    if (command.id === 'hold_fire') {
      engine.toggleHoldFire();
      return;
    }
    if (command.id === 'guard') {
      engine.orderStop();
      return;
    }
    state.setOrderMode(command.mode);
  };

  const onSelectLocation = (location: MechLocation): void => {
    state.setCalledShotLocation(location);
    state.setOrderMode('called_shot');
  };

  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;

  return (
    <div className="app">
      <div className="viewport" ref={hostRef} data-testid="viewport" />

      <header className="topbar" data-testid="topbar">
        <span className="mission">Skirmish — Ridge Pass</span>
        <span className="clock" data-testid="clock">
          {formatClock(state.elapsedSeconds)}
        </span>
        <button
          type="button"
          className={`pause ${state.paused ? 'active' : ''}`}
          onClick={() => engineRef.current?.togglePause()}
          data-testid="pause-button"
        >
          {state.paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <button
          type="button"
          className="pause"
          onClick={() => state.patch({ screen: 'mechbay' })}
          data-testid="open-mechbay"
        >
          Mechbay
        </button>
        <span className="hint">Space pauses · right-click orders · wheel zooms</span>
      </header>

      {state.paused && !state.finished ? (
        <div className="paused-banner" data-testid="paused-banner">
          PAUSED — orders still accepted
        </div>
      ) : null}

      {state.finished ? (
        <div className="outcome" data-testid="outcome">
          {state.winner === null
            ? 'Stalemate'
            : state.winner === state.playerTeam
              ? 'Mission accomplished'
              : 'Lance destroyed'}
        </div>
      ) : null}

      {state.error !== null ? (
        <div className="error" data-testid="error">
          {state.error}
        </div>
      ) : null}

      <aside className="sidebar" data-testid="sidebar">
        {unit === null ? (
          <p className="empty">Select a mech — click it, or press Tab to cycle your lance.</p>
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
            <div className="target-line">
              Target: <strong>{unit.targetName ?? 'none'}</strong>
            </div>
            <WeaponGroups
              unit={unit}
              onToggleGroup={(group) => engineRef.current?.toggleGroup(group)}
            />
          </>
        )}
        <EventLog lines={state.log} />
      </aside>

      <footer className="bottombar">
        <LanceBar
          units={state.units}
          selection={state.selection}
          onSelect={(id) => state.setSelection([id])}
        />
        <CommandPalette
          orderMode={state.orderMode}
          enabled={playerControlled}
          holdingFire={unit?.holdingFire ?? false}
          onCommand={onCommand}
        />
      </footer>
    </div>
  );
}
