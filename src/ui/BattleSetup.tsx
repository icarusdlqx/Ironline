import type { DifficultyChoice } from './battleSetupState';
import { BattleCodeField } from './BattleCodeField';
import './battleSetup.css';

export interface MissionChoice {
  id: string;
  name: string;
}

interface SharedSetupProps {
  missionId: string;
  difficultyId: string;
  missions: readonly MissionChoice[];
  difficulties: readonly DifficultyChoice[];
  campaignMissionName: string | null;
  onMission: (missionId: string) => void;
  onDifficulty: (difficultyId: string) => void;
}

interface BriefingSetupProps extends SharedSetupProps {
  battleCode: string;
  onBattleCode: (battleCode: string) => void;
}

export function BriefingSetup(props: BriefingSetupProps) {
  const difficulty = props.difficulties.find((choice) => choice.id === props.difficultyId);

  return (
    <section className="briefing-setup" data-testid="briefing-setup">
      <h4>Battle setup</h4>
      <div className="briefing-setup-grid">
        <label className="setup-field">
          <span>Mission</span>
          {props.campaignMissionName === null ? (
            <select
              value={props.missionId}
              onChange={(event) => props.onMission(event.target.value)}
              data-testid="briefing-mission-picker"
            >
              {props.missions.map((mission) => (
                <option key={mission.id} value={mission.id}>
                  {mission.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="setup-fixed" data-testid="briefing-mission-fixed">
              {props.campaignMissionName}
              <small>Fixed by contract</small>
            </span>
          )}
        </label>
        <label className="setup-field">
          <span>Difficulty</span>
          <select
            value={props.difficultyId}
            onChange={(event) => props.onDifficulty(event.target.value)}
            data-testid="briefing-difficulty-picker"
          >
            {props.difficulties.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <small className="setup-description" data-testid="difficulty-description">
            {difficulty?.description ?? 'Enemy behaviour follows the selected tier.'}
          </small>
        </label>
        {props.campaignMissionName === null ? (
          <BattleCodeField code={props.battleCode} onCode={props.onBattleCode} />
        ) : null}
      </div>
    </section>
  );
}

export function SetupToolbar({
  locked,
  showActions,
  onRestart,
  onChooseMission,
  ...props
}: SharedSetupProps & {
  locked: boolean;
  showActions: boolean;
  onRestart: () => void;
  onChooseMission: () => void;
}) {
  const difficulty = props.difficulties.find((choice) => choice.id === props.difficultyId);

  return (
    <>
      <select
        className="pause"
        value={props.difficultyId}
        disabled={locked}
        onChange={(event) => props.onDifficulty(event.target.value)}
        title={locked ? 'Difficulty is locked while the lance is deployed.' : difficulty?.description}
        data-testid="difficulty-picker"
      >
        {props.difficulties.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      {props.campaignMissionName === null ? (
        <select
          className="pause"
          value={props.missionId}
          disabled={locked}
          onChange={(event) => props.onMission(event.target.value)}
          title={locked ? 'Mission is locked while the lance is deployed.' : 'Choose a skirmish mission.'}
          data-testid="mission-picker"
        >
          {props.missions.map((mission) => (
            <option key={mission.id} value={mission.id}>
              {mission.name}
            </option>
          ))}
        </select>
      ) : (
        <span
          className="pause setup-contract"
          title="The active contract sets the mission."
          data-testid="mission-fixed"
        >
          {props.campaignMissionName}
        </span>
      )}
      {locked ? (
        <span className="setup-locked" data-testid="setup-locked">
          {difficulty?.label ?? props.difficultyId} · locked
        </span>
      ) : null}
      {showActions ? (
        <span className="setup-run-actions">
          <button
            type="button"
            className="pause"
            onClick={onRestart}
            title="Abandon this run and restart the same battle."
            data-testid="restart-battle"
          >
            Restart
          </button>
          {props.campaignMissionName === null ? (
            <button
              type="button"
              className="pause"
              onClick={() => onChooseMission()}
              title="Abandon this run and return to battle setup."
              data-testid="choose-mission"
            >
              Choose mission
            </button>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
