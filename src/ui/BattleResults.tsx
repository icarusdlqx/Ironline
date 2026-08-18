import { useState } from 'react';
import type { BattleResult } from '../sim/world';
import { viewBattleResult } from './battleResultView';
import './battleResults.css';

export interface ResultMissionOption {
  id: string;
  name: string;
}

interface BattleResultsProps {
  result: BattleResult;
  playerTeam: number;
  missionName: string;
  campaignPending: boolean;
  campaignResolved: boolean;
  missions: readonly ResultMissionOption[];
  selectedMissionId: string;
  onReplay: () => void;
  onChooseMission: (missionId: string) => void;
  onReturnToCampaign: () => void;
}

function accuracyLabel(hits: number, shots: number, accuracy: number | null): string {
  return accuracy === null ? 'No shots' : `${hits} / ${shots} · ${accuracy}%`;
}

export function BattleResults({
  result,
  playerTeam,
  missionName,
  campaignPending,
  campaignResolved,
  missions,
  selectedMissionId,
  onReplay,
  onChooseMission,
  onReturnToCampaign,
}: BattleResultsProps) {
  const report = viewBattleResult(result, playerTeam);
  const [nextMissionId, setNextMissionId] = useState(selectedMissionId);

  return (
    <div
      className="battle-results-backdrop"
      data-testid="outcome"
      role="dialog"
      aria-labelledby="battle-results-title"
    >
      <section className={`battle-results ${report.tone}`}>
        <header className="battle-results-heading">
          <span>{missionName}</span>
          <h2 id="battle-results-title">{report.headline}</h2>
          <p>{report.reason}</p>
        </header>

        <div className="battle-results-summary" aria-label="Battle summary">
          <div>
            <span>Elapsed</span>
            <strong>{report.duration}</strong>
          </div>
          <div>
            <span>Lance</span>
            <strong>
              {report.operational} / {report.lanceSize}
            </strong>
            <small>operational</small>
          </div>
          <div>
            <span>Damage</span>
            <strong>{report.damageDealt} dealt</strong>
            <small>{report.damageTaken} received</small>
          </div>
          <div>
            <span>Gunnery</span>
            <strong>{accuracyLabel(report.shotsHit, report.shotsFired, report.accuracy)}</strong>
            <small>
              {report.kills} kill{report.kills === 1 ? '' : 's'} · {report.hostilesStopped} /{' '}
              {report.hostileCount} hostiles stopped
            </small>
          </div>
        </div>

        <section className="battle-results-lance" aria-labelledby="lance-report-title">
          <h3 id="lance-report-title">Lance report</h3>
          <div className="battle-results-table" role="table">
            <div className="battle-results-row battle-results-labels" role="row">
              <span role="columnheader">Machine</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Damage</span>
              <span role="columnheader">Fire</span>
            </div>
            {report.lance.map((unit) => (
              <div className="battle-results-row" role="row" key={unit.id}>
                <strong role="cell">{unit.name}</strong>
                <span role="cell" className={`unit-result ${unit.status.toLowerCase()}`}>
                  {unit.status}
                  {unit.pilotLost ? <small>Pilot lost</small> : null}
                </span>
                <span role="cell">
                  {unit.damageDealt} / {unit.damageTaken}
                  <small>
                    dealt / received
                    {unit.locationsLost === 0
                      ? ''
                      : ` · ${unit.locationsLost} section${unit.locationsLost === 1 ? '' : 's'} lost`}
                  </small>
                </span>
                <span role="cell">
                  {accuracyLabel(unit.shotsHit, unit.shotsFired, unit.accuracy)}
                  <small>
                    {unit.kills} kill{unit.kills === 1 ? '' : 's'}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>

        {campaignPending ? (
          <div className="battle-results-actions campaign">
            <button type="button" onClick={onReturnToCampaign} data-testid="return-to-campaign">
              {campaignResolved ? 'Back to campaign' : 'Resolve contract'}
            </button>
            <small>
              {campaignResolved
                ? 'The ledger is settled. The field report remains here until you leave.'
                : 'Resolve the contract before returning to the company.'}
            </small>
          </div>
        ) : (
          <div className="battle-results-actions">
            <button type="button" onClick={onReplay} data-testid="replay-mission">
              Replay mission
            </button>
            <label>
              <span>Next mission</span>
              <select
                value={nextMissionId}
                onChange={(event) => setNextMissionId(event.target.value)}
                data-testid="result-mission-picker"
              >
                {missions.map((mission) => (
                  <option key={mission.id} value={mission.id}>
                    {mission.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => onChooseMission(nextMissionId)}
              data-testid="choose-mission"
            >
              Open briefing
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
