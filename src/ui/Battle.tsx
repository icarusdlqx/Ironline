import { useEffect, useMemo, useRef, useState } from 'react';
import { prepareDeployment, resolveMission } from '../campaign/campaign';
import { loadCampaign, saveCampaign } from '../campaign/save';
import type { Design } from '../schema/design';
import { getCatalog } from '../schema/load';
import { BattleHud } from './BattleHud';
import { BattleResults } from './BattleResults';
import { BattleTopbar } from './BattleTopbar';
import { Briefing } from './Briefing';
import { briefingLanceFor } from './briefingLance';
import { createEngine, type Engine } from './engine';
import {
  berthDesign,
  lanceEntries,
  loadLance,
  storeLance,
  type SkirmishBerth,
} from './lance';
import { Mechbay, type BayCommission } from './mechbay/Mechbay';
import { ObjectiveList } from './ObjectiveList';
import { BriefingSetup } from './BattleSetup';
import { difficultyChoices, type BattleSetupKey } from './battleSetupState';
import { useGame } from './store';
import { buildSupportOptions } from './supportOptions';
import { BattleCoach } from './BattleCoach';
import {
  completeTraining,
  skipTraining,
  TRAINING_MISSION_ID,
} from './trainingProgress';
import { useBattleSetup } from './useBattleSetup';
import { checkBattleCode, createNewBattleCode, resultWithBattleCode } from './battleCode';

export function Battle() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const state = useGame();
  const battleSeedRef = useRef(state.battleCode);

  const [resolved, setResolved] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lowFx, setLowFx] = useState(false);
  const missionId = useGame((game) => game.skirmishMissionId);
  const difficulty = useGame((game) => game.difficulty);
  const [battleCodeDraft, setBattleCodeDraft] = useState(state.battleCode);
  const battleCodeCheck = checkBattleCode(battleCodeDraft);

  useEffect(() => setBattleCodeDraft(state.battleCode), [state.battleCode]);

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
  const lanceKey = useMemo(() => JSON.stringify(lance), [lance]);
  const draftSetup = useMemo<BattleSetupKey>(
    () => ({ missionId, difficulty, lanceKey, battleCode: state.battleCode }),
    [missionId, difficulty, lanceKey, state.battleCode],
  );
  const setup = useBattleSetup({
    draft: draftSetup,
    briefingSeen: state.briefingSeen,
    finished: state.finished,
    campaignPending: state.campaignPending,
    patch: state.patch,
  });
  const [outfitting, setOutfitting] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const deployOnReady = setup.nextStart.current === 'deploy';
    setup.nextStart.current = 'briefing';
    let options: Record<string, unknown> = {
      missionId: setup.engine.missionId,
      difficulty: setup.engine.difficulty,
      seed: setup.engine.battleCode,
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
    battleSeedRef.current = String(options.seed ?? setup.engine.battleCode);

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
  }, [setup.engine.missionId, setup.engine.difficulty, setup.engine.lanceKey, setup.engine.battleCode, setup.revision]);

  const restartBattle = (): void => {
    setup.restart();
    setResolved(false);
  };

  const newField = (): void => {
    setup.newField(createNewBattleCode(setup.engine.battleCode));
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
        resolveMission(
          catalog,
          saved,
          resultWithBattleCode(engine.result(), battleSeedRef.current),
          deployment.lance,
        );
        saveCampaign(saved);
      }
      setResolved(true);
      return;
    }
    state.patch({ campaignPending: false, screen: 'campaign' });
  };

  useEffect(() => {
    setMuted(engineRef.current?.audio.muted ?? false);
    setLowFx(engineRef.current?.renderer.lowFx ?? false);
  }, [state.ready]);

  const deployed = setup.locked;

  const briefingLance = state.campaignPending
    ? null
    : briefingLanceFor(catalog, missionId, lance, setLance, setOutfitting);

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
  const battleResult =
    state.finished && engineRef.current !== null
      ? resultWithBattleCode(engineRef.current.result(), battleSeedRef.current)
      : null;

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

      <BattleTopbar
        engine={engineRef.current}
        muted={muted}
        lowFx={lowFx}
        setupMissionId={setup.engine.missionId}
        setupDifficultyId={setup.engine.difficulty}
        missions={missions}
        difficulties={difficulties}
        locked={deployed}
        onMuted={setMuted}
        onLowFx={setLowFx}
        onMission={selectMission}
        onDifficulty={setup.selectDifficulty}
        onRestart={restartBattle}
        onChooseMission={chooseMission}
      />

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
              battleCode={battleCodeDraft}
              missions={missions}
              difficulties={difficulties}
              campaignMissionName={state.campaignPending ? state.missionName : null}
              onMission={selectMission}
              onDifficulty={setup.selectDifficulty}
              onBattleCode={setBattleCodeDraft}
            />
          }
          {...(briefingLance === null ? {} : { lance: briefingLance })}
          deployDisabled={!state.campaignPending && !battleCodeCheck.ok}
          deployReason={state.campaignPending ? null : battleCodeCheck.reason}
          onDeploy={() => {
            if (!state.campaignPending && !battleCodeCheck.ok) return;
            const battleCode = state.campaignPending
              ? setup.engine.battleCode
              : battleCodeCheck.ok
                ? battleCodeCheck.code
                : setup.engine.battleCode;
            if (!state.campaignPending) state.patch({ battleCode });
            setup.deploy({ ...setup.engine, battleCode });
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

      {state.briefingSeen ? <ObjectiveList objectives={state.objectives} zones={state.zones} /> : null}
      {state.briefingSeen && !state.campaignPending ? <BattleCoach missionId={missionId} /> : null}

      {state.briefingSeen && state.paused && !state.finished ? (
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
          onSameField={restartBattle}
          onNewField={newField}
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

      {state.briefingSeen ? <BattleHud engine={engineRef.current} supportOptions={supportOptions} /> : null}
    </div>
  );
}
