import { useEffect, useMemo, useRef, useState } from 'react';
import { dropTonnageFor, prepareDeployment, resolveMission } from '../campaign/campaign';
import { loadCampaign, saveCampaign } from '../campaign/save';
import type { Design } from '../schema/design';
import { getCatalog } from '../schema/load';
import type { MechLocation } from '../schema/common';
import { CommandPalette, type Command } from './CommandPalette';
import { BattleResults } from './BattleResults';
import { createEngine, type Engine } from './engine';
import {
  berthDesign,
  lanceEntries,
  lanceTonnage,
  loadLance,
  storeLance,
  type SkirmishBerth,
} from './lance';
import { listStoredDesigns, loadFromStorage } from './mechbay/editor';
import { Mechbay, type BayCommission } from './mechbay/Mechbay';
import {
  Briefing,
  EventLog,
  HeatBar,
  HostileBar,
  LanceBar,
  ObjectiveList,
  SupportPalette,
  WeaponGroups,
  type BriefingLance,
} from './Panels';
import { Minimap } from './Minimap';
import { PaperDoll } from './PaperDoll';
import { BriefingSetup, SetupToolbar } from './BattleSetup';
import { difficultyChoices, type BattleSetupKey } from './battleSetupState';
import { formatMissionClock, missionClockUrgency } from './missionClock';
import { selectedUnit, useGame } from './store';
import { buildSupportOptions } from './supportOptions';
import { TacticalReadout } from './TacticalReadout';
import { TrainingCoach } from './TrainingCoach';
import {
  completeTraining,
  skipTraining,
  TRAINING_MISSION_ID,
} from './trainingProgress';
import { useBattleSetup } from './useBattleSetup';

export function Battle() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const state = useGame();
  const unit = selectedUnit(state);
  // The readout is only trusted when it is priced for the mech on screen: the
  // HUD refreshes at 10Hz, and a stale reading for the last selection is worse
  // than none.
  const preview =
    unit !== null && state.hitPreview !== null && state.hitPreview.shooterId === unit.id
      ? state.hitPreview
      : null;

  const [resolved, setResolved] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lowFx, setLowFx] = useState(false);
  const missionId = useGame((game) => game.skirmishMissionId);
  const difficulty = useGame((game) => game.difficulty);
  const remainingSeconds = Math.max(0, state.missionDurationSeconds - state.elapsedSeconds);
  const clockUrgency = missionClockUrgency(remainingSeconds);

  // The skirmish lance, edited at the briefing. Kept per mission so switching
  // missions never carries the wrong machines across, persisted so a loadout
  // survives a reload. Campaign drops ignore this: their lance is the
  // dropship manifest's decision.
  const [lanceEdits, setLanceEdits] = useState<Record<string, SkirmishBerth[]>>({});
  const catalog = getCatalog();
  const missions = useMemo(
    () =>
      [...catalog.missions.values()]
        .sort((left, right) =>
          left.id === TRAINING_MISSION_ID ? -1 : right.id === TRAINING_MISSION_ID ? 1 : 0,
        )
        .map((mission) => ({ id: mission.id, name: mission.name })),
    [catalog],
  );
  const difficulties = useMemo(() => difficultyChoices(catalog.rules.difficulty), [catalog]);
  const lance = useMemo(
    () => lanceEdits[missionId] ?? loadLance(catalog, missionId),
    [lanceEdits, catalog, missionId],
  );
  const setLance = (next: SkirmishBerth[]): void => {
    setLanceEdits((edits) => ({ ...edits, [missionId]: next }));
    storeLance(missionId, next);
  };
  // The engine rebuilds when the lance actually changes, not on every render.
  const lanceKey = useMemo(() => JSON.stringify(lance), [lance]);
  const draftSetup = useMemo<BattleSetupKey>(
    () => ({ missionId, difficulty, lanceKey }),
    [missionId, difficulty, lanceKey],
  );
  const setup = useBattleSetup({
    draft: draftSetup,
    briefingSeen: state.briefingSeen,
    finished: state.finished,
    campaignPending: state.campaignPending,
    patch: state.patch,
  });
  // Which berth is open in the bay, if any.
  const [outfitting, setOutfitting] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const deployOnReady = setup.nextStart.current === 'deploy';
    setup.nextStart.current = 'briefing';
    let options: Record<string, unknown> = {
      missionId: setup.engine.missionId,
      difficulty: setup.engine.difficulty,
    };
    const entries = lanceEntries(
      getCatalog(),
      JSON.parse(setup.engine.lanceKey) as SkirmishBerth[],
    );
    if (entries !== null && entries.length > 0) options = { ...options, playerLance: entries };
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
            difficulty: setup.engine.difficulty,
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
        if (deployOnReady) {
          engine.renderer.camera.beginDropIn();
          useGame.getState().patch({ briefingSeen: true, paused: false });
        }
      })
      .catch((error: unknown) => {
        useGame.getState().patch({ error: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [setup.engine.missionId, setup.engine.difficulty, setup.engine.lanceKey, setup.revision]);

  const restartBattle = (): void => {
    setup.restart();
    setResolved(false);
  };

  const chooseMission = (nextMissionId = setup.engine.missionId): void => {
    if (setup.engine.missionId === TRAINING_MISSION_ID && nextMissionId !== TRAINING_MISSION_ID) {
      skipTraining();
    }
    setup.chooseMission(nextMissionId);
    setResolved(false);
  };

  const selectMission = (nextMissionId: string): void => {
    if (missionId === TRAINING_MISSION_ID && nextMissionId !== TRAINING_MISSION_ID) {
      skipTraining();
    }
    setup.selectMission(nextMissionId);
  };

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
    if (command.id === 'hold_position') {
      engine.setPosture(command.id);
      return;
    }
    if (command.id === 'ability') {
      engine.useAbilities();
      return;
    }
    if (command.id === 'alpha_strike') {
      engine.alphaStrike();
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
    setLowFx(engineRef.current?.renderer.lowFx ?? false);
  }, [state.ready]);

  const playerControlled = unit !== null && unit.team === state.playerTeam && unit.alive;

  // Leaving the battle screen destroys the engine. Setup is the deliberate
  // way back while a lance is in the field, whether money is riding on it or not.
  const deployed = setup.locked;

  // The briefing's lance panel: skirmish only. A campaign drop already made
  // these decisions on the dropship manifest.
  const briefingLance: BriefingLance | null = state.campaignPending
    ? null
    : {
        berths: lance.map((berth, index) => ({
          index,
          designValue: berth.empty === true ? 'empty' : (berth.designId ?? 'custom'),
          customLabel: berth.designId === null ? (berth.design?.name ?? 'Custom build') : null,
          pilotId: berth.pilotId,
          tonnage: catalog.chassis.get(berthDesign(catalog, berth)?.chassisId ?? '')?.tonnage ?? 0,
          pilot: catalog.pilots.get(berth.pilotId) ?? null,
        })),
        // Mechs only. Vehicles and emplacements are what the other side
        // fields; a berth on the dropship is for something that walks.
        designs: [...catalog.designs.values()]
          .filter((design) => catalog.chassis.get(design.chassisId)?.frame === 'mech')
          .map((design) => ({
            value: design.id,
            label: design.name,
            tonnage: catalog.chassis.get(design.chassisId)?.tonnage ?? 0,
          })),
        saved: listStoredDesigns().map((id) => ({ value: `saved:${id}`, label: id })),
        pilots: [...catalog.pilots.values()].map((pilot) => ({ id: pilot.id, name: pilot.name })),
        total: lanceTonnage(catalog, lance),
        allowance: dropTonnageFor(catalog, missionId),
        onDesign: (index, value) => {
          const next = lance.map((berth) => ({ ...berth }));
          const target = next[index];
          if (target === undefined) return;
          if (value === 'empty') {
            target.empty = true;
            target.designId = null;
            delete target.design;
          } else if (value.startsWith('saved:')) {
            // A saved build is the player's own: frozen into the berth, so
            // later edits to the saved copy do not silently rewrite the lance.
            const result = loadFromStorage(value.slice('saved:'.length));
            if (result.design === null) return;
            delete target.empty;
            target.designId = null;
            target.design = result.design;
          } else if (value !== 'custom') {
            delete target.empty;
            target.designId = value;
            delete target.design;
          }
          setLance(next);
        },
        onPilot: (index, pilotId) => {
          const next = lance.map((berth) => ({ ...berth }));
          const target = next[index];
          if (target === undefined) return;
          target.pilotId = pilotId;
          setLance(next);
        },
        onCustomise: setOutfitting,
      };

  // The berth open in the bay, as a commission whose commit rewrites it.
  const outfitBerth = outfitting === null ? null : (lance[outfitting] ?? null);
  const outfitBay: BayCommission | null =
    outfitting === null || outfitBerth === null
      ? null
      : {
          title: `Berth ${outfitting + 1}`,
          design: berthDesign(catalog, outfitBerth) ?? (catalog.designs.get('sentinel_brawler') as Design),
          onCancel: () => setOutfitting(null),
          onCommit: (design) => {
            const next = lance.map((berth) => ({ ...berth }));
            const target = next[outfitting];
            if (target === undefined) return { ok: false, reason: 'no such berth' };
            target.designId = null;
            target.design = design;
            setLance(next);
            setOutfitting(null);
            return { ok: true, reason: null };
          },
        };

  const supportOptions = useMemo(
    () => buildSupportOptions(catalog.rules.support, state.reservesLeft),
    [catalog.rules.support, state.reservesLeft],
  );
  const battleResult = state.finished ? (engineRef.current?.result() ?? null) : null;

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
        <span
          className={`clock clock-${clockUrgency}`}
          data-testid="clock"
          title="Mission time remaining"
          aria-label={`Mission time remaining ${formatMissionClock(remainingSeconds)}`}
        >
          TIME {formatMissionClock(remainingSeconds)}
        </span>
        <button
          type="button"
          className={`pause ${state.paused ? 'active' : ''}`}
          onClick={() => engineRef.current?.togglePause()}
          data-testid="pause-button"
        >
          {state.paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <span className="speed-controls" data-testid="speed-controls">
          {[1, 2, 4].map((speed) => (
            <button
              key={speed}
              type="button"
              className={`pause ${!state.paused && state.speed === speed ? 'active' : ''}`}
              onClick={() => engineRef.current?.setSpeed(speed)}
              title={`Run the battle at ${speed}× (, and . step speed)`}
              data-testid={`speed-${speed}`}
            >
              {speed}×
            </button>
          ))}
        </span>
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
          className={`pause ${lowFx ? 'active' : ''}`}
          onClick={() => setLowFx(engineRef.current?.toggleLowFx() ?? false)}
          title={
            lowFx
              ? 'Low graphics: shadows off, resolution down. Click for full.'
              : 'Full graphics. Click to drop shadows and resolution if the game stutters.'
          }
          data-testid="fx-toggle"
        >
          {lowFx ? 'FX low' : 'FX full'}
        </button>
        <button
          type="button"
          className="pause"
          disabled={deployed}
          title={
            deployed
              ? state.campaignPending
                ? 'The lance is in the field — resolve the contract first.'
                : 'The lance is in the field — choose a mission to leave this run.'
              : ''
          }
          onClick={() => state.patch({ screen: 'mechbay' })}
          data-testid="open-mechbay"
        >
          Mechbay
        </button>
        <button
          type="button"
          className="pause"
          disabled={deployed}
          title={
            deployed
              ? state.campaignPending
                ? 'The lance is in the field — resolve the contract first.'
                : 'The lance is in the field — choose a mission to leave this run.'
              : ''
          }
          onClick={() => state.patch({ screen: 'campaign' })}
          data-testid="open-campaign"
        >
          Campaign
        </button>
        <SetupToolbar
          missionId={setup.engine.missionId}
          difficultyId={setup.engine.difficulty}
          missions={missions}
          difficulties={difficulties}
          campaignMissionName={state.campaignPending ? state.missionName : null}
          locked={setup.locked}
          showActions={setup.locked && !state.finished}
          onMission={selectMission}
          onDifficulty={setup.selectDifficulty}
          onRestart={restartBattle}
          onChooseMission={chooseMission}
        />
        <a
          className="pause feedback-link"
          href="https://github.com/icarusdlqx/Ironline/issues"
          target="_blank"
          rel="noreferrer"
          title="Something broken, unfair, or missing? Tell the builders."
          data-testid="feedback-link"
        >
          Feedback
        </a>
        <span className="hint">
          Space pauses · , . change speed · P perf graph · click an enemy to attack ·
          right-click moves (shift queues) · A attack-moves · drag selects · arrows pan · wheel zooms
        </span>
      </header>

      {!state.briefingSeen && state.briefing !== '' && !state.finished ? (
        <Briefing
          name={state.missionName}
          text={state.briefing}
          objectives={state.objectives}
          resourcePoints={state.resourcePoints}
          setup={
            <BriefingSetup
              missionId={setup.engine.missionId}
              difficultyId={setup.engine.difficulty}
              missions={missions}
              difficulties={difficulties}
              campaignMissionName={state.campaignPending ? state.missionName : null}
              onMission={selectMission}
              onDifficulty={setup.selectDifficulty}
            />
          }
          {...(briefingLance === null ? {} : { lance: briefingLance })}
          onDeploy={() => {
            // The establishing shot belongs to the moment the lance actually
            // drops, not to when the renderer was built behind the briefing.
            engineRef.current?.renderer.camera.beginDropIn();
            setup.lockDraft();
            state.patch({ briefingSeen: true, paused: false });
          }}
        />
      ) : null}

      {/* The bay, opened on one berth of the skirmish lance. Commits replace
          that berth's design; the engine rebuilds with the new machine. */}
      {outfitBay === null ? null : (
        <div className="manifest-backdrop" data-testid="outfit-bay">
          <div className="refit-bay">
            <Mechbay onExit={() => setOutfitting(null)} commission={outfitBay} />
          </div>
        </div>
      )}

      <ObjectiveList objectives={state.objectives} zones={state.zones} />
      {missionId === TRAINING_MISSION_ID && !state.campaignPending ? <TrainingCoach /> : null}

      {state.paused && !state.finished ? (
        <div className="paused-banner" data-testid="paused-banner">
          PAUSED — orders still accepted
        </div>
      ) : null}

      {battleResult === null ? null : (
        <BattleResults
          result={battleResult}
          playerTeam={state.playerTeam}
          missionName={state.missionName}
          campaignPending={state.campaignPending}
          campaignResolved={resolved}
          missions={[...catalog.missions.values()].map((mission) => ({
            id: mission.id,
            name: mission.name,
          }))}
          selectedMissionId={missionId}
          onReplay={restartBattle}
          onChooseMission={chooseMission}
          onReturnToCampaign={onReturnToCampaign}
          {...(missionId === TRAINING_MISSION_ID && state.missionStatus === 'success'
            ? {
                onContinueToCampaign: () => {
                  completeTraining();
                  state.patch({ screen: 'campaign' });
                },
              }
            : {})}
        />
      )}

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
            <TacticalReadout unit={unit} />
            <div className="target-line">
              {preview === null ? (
                <>
                  Target: <strong>{unit.targetName ?? 'none'}</strong>
                </>
              ) : (
                <>
                  {preview.hover ? 'Sizing up' : 'Target'}:{' '}
                  <strong>{preview.targetName}</strong>
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
              onToggleGroup={(group) => engineRef.current?.toggleGroup(group)}
              {...(preview === null ? {} : { preview })}
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
          ability={unit?.ability ?? null}
          alpha={unit?.alpha ?? null}
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
