import type { BattleTopbarProps } from './BattleTopbar';
import { SetupToolbar } from './BattleSetup';
import { formatMissionClock, missionClockUrgency } from './missionClock';
import { usePlaytest } from './playtest';
import { useGame } from './store';
import { trainingShowsFullHud } from './trainingPresentation';

export function MobileBattleTopbar(props: BattleTopbarProps) {
  const state = useGame();
  const { openFeedback } = usePlaytest();
  const fullHud = trainingShowsFullHud(props.trainingStep ?? null);
  const remainingSeconds = Math.max(0, state.missionDurationSeconds - state.elapsedSeconds);
  const speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1;
  const lockedTitle = state.campaignPending
    ? 'The lance is in the field — resolve the contract first.'
    : 'The lance is in the field — choose a mission to leave this run.';

  return (
    <header
      className={`topbar mobile-topbar${fullHud ? '' : ' training-topbar'}`}
      data-testid="topbar"
    >
      {fullHud ? (
        <span
          className={`clock clock-${missionClockUrgency(remainingSeconds)}`}
          data-testid="clock"
          aria-label={`Mission time remaining ${formatMissionClock(remainingSeconds)}`}
        >
          {formatMissionClock(remainingSeconds)}
        </span>
      ) : (
        <span className="mission">{state.missionName}</span>
      )}
      <button
        type="button"
        className={`pause ${state.paused ? 'active' : ''}`}
        disabled={!state.briefingSeen}
        onClick={() => props.engine?.togglePause()}
        data-testid="pause-button"
      >
        {!state.briefingSeen ? 'Briefing' : state.paused ? '▶ Resume' : '❚❚ Pause'}
      </button>
      {fullHud ? (
        <button
          type="button"
          className="pause mobile-speed"
          disabled={!state.briefingSeen}
          onClick={() => props.engine?.setSpeed(speed)}
          title="Cycle battle speed"
          data-testid="mobile-speed"
        >
          {state.speed}×
        </button>
      ) : (
        <button
          type="button"
          className="pause"
          onClick={() => props.onMuted(props.engine?.audio.toggleMuted() ?? false)}
          title={props.muted ? 'Sound is off' : 'Sound is on'}
          data-testid="mute-button"
        >
          {props.muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
      )}
      {fullHud ? (
        <details className="mobile-battle-menu">
          <summary data-testid="mobile-menu-toggle">Menu</summary>
          <div className="mobile-menu-sheet" data-testid="mobile-menu-sheet">
            <strong>{state.missionName}</strong>
            <div className="mobile-menu-buttons">
              <button
                type="button"
                className="pause"
                onClick={() => props.onMuted(props.engine?.audio.toggleMuted() ?? false)}
                data-testid="mute-button"
              >
                {props.muted ? 'Sound off' : 'Sound on'}
              </button>
              <button
                type="button"
                className={`pause ${props.lowFx ? 'active' : ''}`}
                onClick={() => props.onLowFx(props.engine?.toggleLowFx() ?? false)}
                data-testid="fx-toggle"
              >
                {props.lowFx ? 'FX low' : 'FX full'}
              </button>
              <button
                type="button"
                className="pause"
                disabled={props.locked}
                title={props.locked ? lockedTitle : ''}
                onClick={() => state.patch({ screen: 'mechbay' })}
                data-testid="open-mechbay"
              >
                Mechbay
              </button>
              <button
                type="button"
                className="pause"
                disabled={props.locked}
                title={props.locked ? lockedTitle : ''}
                onClick={() => state.patch({ screen: 'campaign' })}
                data-testid="open-campaign"
              >
                Campaign
              </button>
            </div>
            <SetupToolbar
              missionId={props.setupMissionId}
              difficultyId={props.setupDifficultyId}
              missions={props.missions}
              difficulties={props.difficulties}
              campaignMissionName={state.campaignPending ? state.missionName : null}
              locked={props.locked}
              showActions={props.locked && !state.finished}
              onMission={props.onMission}
              onDifficulty={props.onDifficulty}
              onRestart={props.onRestart}
              onChooseMission={props.onChooseMission}
            />
            <button
              type="button"
              className="pause feedback-link"
              onClick={openFeedback}
              data-testid="feedback-link"
            >
              Feedback
            </button>
          </div>
        </details>
      ) : (
        <button
          type="button"
          className={`pause ${props.lowFx ? 'active' : ''}`}
          onClick={() => props.onLowFx(props.engine?.toggleLowFx() ?? false)}
          data-testid="fx-toggle"
        >
          {props.lowFx ? 'FX low' : 'FX full'}
        </button>
      )}
    </header>
  );
}
