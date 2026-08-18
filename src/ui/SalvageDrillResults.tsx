import { getCatalog } from '../schema/load';
import type { BattleResult } from '../sim/world';
import {
  percentChance,
  salvageDrillReport,
  SALVAGE_DRILL_MISSION_ID,
} from './salvageDrill';
import './salvageDrill.css';

export function SalvageDrillResults({
  result,
  playerTeam,
}: {
  result: BattleResult;
  playerTeam: number;
}) {
  if (result.missionId !== SALVAGE_DRILL_MISSION_ID) return null;
  const report = salvageDrillReport(result, playerTeam, getCatalog().rules.salvage);

  return (
    <section className="salvage-drill-results" aria-labelledby="salvage-drill-result-title">
      <header>
        <span>Field exercise · no inventory or C-bill reward</span>
        <h3 id="salvage-drill-result-title">
          {report.standardMet ? 'High-salvage standard met' : 'High-salvage standard not met'}
        </h3>
      </header>
      <div className="salvage-drill-grade">
        <div>
          <span>Range target</span>
          <strong>{report.targetName}</strong>
        </div>
        <div>
          <span>Legs lost</span>
          <strong>{report.legsLost} / 2</strong>
        </div>
        <div>
          <span>Field outcome</span>
          <strong>{report.outcomeLabel}</strong>
        </div>
        <div>
          <span>Base hull chance</span>
          <strong>{percentChance(report.baseHullChance)}</strong>
        </div>
      </div>
      <p>
        The base chance is the campaign hull-condition chance before any contract salvage share.
        It is not a guarantee, and no recovery roll is made here. Nothing is added to inventory and
        no C-bills are paid.
      </p>
    </section>
  );
}
