import type { DifficultyChoice } from './battleSetupState';
import type { MissionChoice } from './BattleSetup';
import { SetupToolbar } from './BattleSetup';
import type { Engine } from './engine';
import { formatMissionClock, missionClockUrgency } from './missionClock';
import { MobileBattleTopbar } from './MobileBattleTopbar';
import { usePlaytest } from './playtest';
import { useGame } from './store';
import { trainingShowsFullHud } from './trainingPresentation';
import type { TrainingStep } from './trainingProgress';
import { useCompactLayout } from './useCompactLayout';

export interface BattleTopbarProps {
  engine: Engine | null;
  muted: boolean;
  lowFx: boolean;
  setupMissionId: string;
  setupDifficultyId: string;
  missions: readonly MissionChoice[];
  difficulties: readonly DifficultyChoice[];
  locked: boolean;
  trainingStep?: TrainingStep | null;
  onMuted: (muted: boolean) => void;
  onLowFx: (lowFx: boolean) => void;
  onMission: (missionId: string) => void;
  onDifficulty: (difficultyId: string) => void;
  onRestart: () => void;
  onChooseMission: () => void;
}

export function BattleTopbar({
  engine,
  muted,
  lowFx,
  setupMissionId,
  setupDifficultyId,
  missions,
  difficulties,
  locked,
  trainingStep = null,
  onMuted,
  onLowFx,
  onMission,
  onDifficulty,
  onRestart,
  onChooseMission,
}: BattleTopbarProps) {
  const state = useGame();
  const { openFeedback } = usePlaytest();
  const compact = useCompactLayout();
  if (compact) {
    return (
      <MobileBattleTopbar
        engine={engine}
        muted={muted}
        lowFx={lowFx}
        setupMissionId={setupMissionId}
        setupDifficultyId={setupDifficultyId}
        missions={missions}
        difficulties={difficulties}
        locked={locked}
        trainingStep={trainingStep}
        onMuted={onMuted}
        onLowFx={onLowFx}
        onMission={onMission}
        onDifficulty={onDifficulty}
        onRestart={onRestart}
        onChooseMission={onChooseMission}
      />
    );
  }
  const remainingSeconds = Math.max(0, state.missionDurationSeconds - state.elapsedSeconds);
  const clockUrgency = missionClockUrgency(remainingSeconds);
  const fullHud = trainingShowsFullHud(trainingStep);
  const lockedTitle = state.campaignPending
    ? 'The lance is in the field — resolve the contract first.'
    : 'The lance is in the field — choose a mission to leave this run.';

  return (
    <header className={`topbar${fullHud ? '' : ' training-topbar'}`} data-testid="topbar">
      <span className="mission">{state.missionName}</span>
      {fullHud ? (
        <span
          className={`clock clock-${clockUrgency}`}
          data-testid="clock"
          title="Mission time remaining"
          aria-label={`Mission time remaining ${formatMissionClock(remainingSeconds)}`}
        >
          TIME {formatMissionClock(remainingSeconds)}
        </span>
      ) : null}
      <button
        type="button"
        className={`pause ${state.paused ? 'active' : ''}`}
        disabled={!state.briefingSeen}
        onClick={() => engine?.togglePause()}
        data-testid="pause-button"
      >
        {!state.briefingSeen ? 'Briefing' : state.paused ? '▶ Resume' : '❚❚ Pause'}
      </button>
      {fullHud ? (
        <span className="speed-controls" data-testid="speed-controls">
          {[1, 2, 4].map((speed) => (
            <button
              key={speed}
              type="button"
              className={`pause ${!state.paused && state.speed === speed ? 'active' : ''}`}
              disabled={!state.briefingSeen}
              onClick={() => engine?.setSpeed(speed)}
              title={`Run the battle at ${speed}× (, and . step speed)`}
              data-testid={`speed-${speed}`}
            >
              {speed}×
            </button>
          ))}
        </span>
      ) : null}
      <button
        type="button"
        className="pause"
        onClick={() => onMuted(engine?.audio.toggleMuted() ?? false)}
        title={muted ? 'Sound is off' : 'Sound is on'}
        data-testid="mute-button"
      >
        {muted ? '\u{1F507}' : '\u{1F50A}'}
      </button>
      <button
        type="button"
        className={`pause ${lowFx ? 'active' : ''}`}
        onClick={() => onLowFx(engine?.toggleLowFx() ?? false)}
        title={
          lowFx
            ? 'Low graphics: shadows off, resolution down. Click for full.'
            : 'Full graphics. Click to drop shadows and resolution if the game stutters.'
        }
        data-testid="fx-toggle"
      >
        {lowFx ? 'FX low' : 'FX full'}
      </button>
      {fullHud ? (
        <>
          <button
            type="button"
            className="pause"
            disabled={locked}
            title={locked ? lockedTitle : ''}
            onClick={() => state.patch({ screen: 'mechbay' })}
            data-testid="open-mechbay"
          >
            Mechbay
          </button>
          <button
            type="button"
            className="pause"
            disabled={locked}
            title={locked ? lockedTitle : ''}
            onClick={() => state.patch({ screen: 'campaign' })}
            data-testid="open-campaign"
          >
            Campaign
          </button>
          <SetupToolbar
            missionId={setupMissionId}
            difficultyId={setupDifficultyId}
            missions={missions}
            difficulties={difficulties}
            campaignMissionName={state.campaignPending ? state.missionName : null}
            locked={locked}
            showActions={locked && !state.finished}
            onMission={onMission}
            onDifficulty={onDifficulty}
            onRestart={onRestart}
            onChooseMission={onChooseMission}
          />
          <button
            type="button"
            className="pause feedback-link"
            onClick={openFeedback}
            title="Something broken, unfair, or missing? Tell the builders."
            data-testid="feedback-link"
          >
            Feedback
          </button>
          <span className="hint">
            Space pauses · , . change speed · P perf graph · click an enemy to attack ·
            right-click moves (shift queues) · A attack-moves · drag selects · arrows pan · wheel zooms · Centre recentres
          </span>
        </>
      ) : null}
    </header>
  );
}
