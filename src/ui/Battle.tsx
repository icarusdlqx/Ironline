import { useEffect, useRef, useState } from 'react';
import { prepareDeployment, resolveMission } from '../campaign/campaign';
import { loadCampaign, saveCampaign } from '../campaign/save';
import { getCatalog } from '../schema/load';
import { SUPPORT_CALLS } from '../sim/support';
import type { MechLocation } from '../schema/common';
import { CommandPalette, type Command } from './CommandPalette';
import { createEngine, type Engine } from './engine';
import {
  Briefing,
  EventLog,
  HeatBar,
  HostileBar,
  LanceBar,
  ObjectiveList,
  SupportPalette,
  WeaponGroups,
  type SupportOption,
} from './Panels';
import { Minimap } from './Minimap';
import { PaperDoll } from './PaperDoll';
import { selectedUnit, storeDifficulty, useGame } from './store';

const SUPPORT_HINTS: Record<string, string> = {
  sensor_probe: 'Reveals a map region',
  artillery_strike: 'Delayed area damage',
  air_strike: 'Fast linear strafe',
  repair_truck: 'Repairs armour nearby',
  minelayer: 'Lays a defensive minefield',
  reinforcement: 'Drops a reserve mech',
};

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

  const [resolved, setResolved] = useState(false);
  const [muted, setMuted] = useState(false);
  const missionId = useGame((game) => game.skirmishMissionId);
  const difficulty = useGame((game) => game.difficulty);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let options: Record<string, unknown> = { missionId, difficulty };
    if (useGame.getState().campaignPending) {
      const saved = loadCampaign().state;
      if (saved !== null) {
        try {
          const deployment = prepareDeployment(getCatalog(), saved);
          options = {
            missionId: deployment.missionId,
            seed: deployment.seed,
            playerTeam: deployment.playerTeam,
            playerLance: deployment.entries,
            difficulty,
          };
        } catch (error: unknown) {
          // Nothing fit to field. Say so and go back rather than tearing down
          // the React tree with an uncaught throw from an effect.
          useGame.getState().patch({
            campaignPending: false,
            screen: 'campaign',
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
    }

    let cancelled = false;
    createEngine(host, options)
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
  }, [missionId, difficulty]);

  const onReturnToCampaign = (): void => {
    const engine = engineRef.current;
    if (engine !== null && !resolved) {
      const catalog = getCatalog();
      const saved = loadCampaign().state;
      if (saved !== null) {
        const deployment = prepareDeployment(catalog, saved);
        resolveMission(catalog, saved, engine.result(), deployment.lance);
        saveCampaign(saved);
      }
      setResolved(true);
      return;
    }
    state.patch({ campaignPending: false, screen: 'campaign' });
  };

  const onCommand = (command: Command): void => {
    const engine = engineRef.current;
    if (engine === null) return;

    if (command.id === 'hold_fire') {
      engine.toggleHoldFire();
      return;
    }
    if (command.id === 'hold_position' || command.id === 'return_fire' || command.id === 'keep_facing') {
      engine.setPosture(command.id);
      return;
    }
    if (command.id === 'heat_safety') {
      engine.toggleHeatSafety();
      return;
    }
    state.setOrderMode(command.mode);
  };

  const onSelectLocation = (location: MechLocation): void => {
    state.setCalledShotLocation(location);
    state.setOrderMode('called_shot');
  };

  useEffect(() => {
    setMuted(engineRef.current?.audio.muted ?? false);
  }, [state.ready]);

  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;

  // Leaving the battle screen unmounts it, which destroys the engine — the
  // contract would silently restart from the top with the lance already paid
  // for. There is nowhere useful to go mid-contract anyway.
  const deployed = state.campaignPending && !state.finished;

  const supportOptions: SupportOption[] = SUPPORT_CALLS.map((id) => ({
    id,
    label: id
      .split('_')
      .map((word) => `${(word[0] ?? '').toUpperCase()}${word.slice(1)}`)
      .join(' '),
    cost: getCatalog().rules.support[id].cost,
    hint: SUPPORT_HINTS[id] ?? '',
  }));

  return (
    <div className="app">
      <div className="viewport" ref={hostRef} data-testid="viewport" />

      {state.marquee === null ? null : (
        <div
          className="marquee"
          data-testid="marquee"
          style={{
            left: state.marquee.x,
            top: state.marquee.y,
            width: state.marquee.width,
            height: state.marquee.height,
          }}
        />
      )}

      <header className="topbar" data-testid="topbar">
        <span className="mission">{state.missionName}</span>
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
          onClick={() => setMuted(engineRef.current?.audio.toggleMuted() ?? false)}
          title={muted ? 'Sound is off' : 'Sound is on'}
          data-testid="mute-button"
        >
          {muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
        <button
          type="button"
          className="pause"
          disabled={deployed}
          title={deployed ? 'The lance is in the field — resolve the contract first.' : ''}
          onClick={() => state.patch({ screen: 'mechbay' })}
          data-testid="open-mechbay"
        >
          Mechbay
        </button>
        <button
          type="button"
          className="pause"
          disabled={deployed}
          title={deployed ? 'The lance is in the field — resolve the contract first.' : ''}
          onClick={() => state.patch({ screen: 'campaign' })}
          data-testid="open-campaign"
        >
          Campaign
        </button>
        <select
          className="pause"
          value={difficulty}
          onChange={(event) => {
            storeDifficulty(event.target.value);
            state.patch({ difficulty: event.target.value });
          }}
          title="How hard the enemy fights. Takes effect when the next battle starts."
          data-testid="difficulty-picker"
        >
          {Object.keys(getCatalog().rules.difficulty.tiers).map((tier) => (
            <option key={tier} value={tier}>
              {tier[0]?.toUpperCase()}{tier.slice(1)}
            </option>
          ))}
        </select>
        <select
          className="pause"
          value={missionId}
          disabled={state.campaignPending}
          onChange={(event) => state.patch({ skirmishMissionId: event.target.value })}
          data-testid="mission-picker"
        >
          {[...getCatalog().missions.values()].map((mission) => (
            <option key={mission.id} value={mission.id}>
              {mission.name}
            </option>
          ))}
        </select>
        <span className="hint">
          Space pauses · click an enemy to attack · right-click moves (shift queues) · A
          attack-moves · drag selects · arrows pan · wheel zooms
        </span>
      </header>

      {!state.briefingSeen && state.briefing !== '' && !state.finished ? (
        <Briefing
          name={state.missionName}
          text={state.briefing}
          objectives={state.objectives}
          resourcePoints={state.resourcePoints}
          onDeploy={() => state.patch({ briefingSeen: true, paused: false })}
        />
      ) : null}

      <ObjectiveList objectives={state.objectives} zones={state.zones} />

      {state.paused && !state.finished ? (
        <div className="paused-banner" data-testid="paused-banner">
          PAUSED — orders still accepted
        </div>
      ) : null}

      {state.finished ? (
        <div className="outcome" data-testid="outcome">
          <span>
            {state.missionStatus === 'success'
              ? 'Mission accomplished'
              : state.missionStatus === 'failure'
                ? `Mission failed — ${state.missionReason ?? ''}`
                : state.winner === state.playerTeam
                  ? 'Mission accomplished'
                  : 'Lance destroyed'}
          </span>
          {state.campaignPending ? (
            <button type="button" onClick={onReturnToCampaign} data-testid="return-to-campaign">
              {resolved ? 'Back to campaign' : 'Resolve contract'}
            </button>
          ) : null}
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

      <HostileBar
        enemies={state.enemies}
        targetIds={
          new Set(
            state.units
              .filter((entry) => state.selection.includes(entry.id) && entry.targetName !== null)
              .flatMap((entry) => {
                const shot = state.enemies.find((foe) => foe.name === entry.targetName);
                return shot === undefined ? [] : [shot.id];
              }),
          )
        }
        hasSelection={state.units.some(
          (entry) => state.selection.includes(entry.id) && entry.alive,
        )}
        onTarget={(id) => engineRef.current?.orderAttack(id, null)}
      />

      <Minimap engine={engineRef.current} />

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
          heatSafety={unit?.heatSafety ?? false}
          jump={
            unit === null
              ? null
              : { ready: unit.canJump, range: unit.jumpRange, cooldown: unit.jumpCooldown }
          }
          posture={unit?.posture ?? 'free'}
          onCommand={onCommand}
        />
        <SupportPalette
          options={supportOptions}
          resourcePoints={state.resourcePoints}
          active={state.supportMode}
          reservesLeft={state.reservesLeft}
          onPick={(call) => state.setSupportMode(state.supportMode === call ? null : call)}
        />
      </footer>
    </div>
  );
}
