import { contractCommitment, formatMissionClock } from '../../campaign/contractBriefing';
import { sideContractProfile } from '../../campaign/sidework';
import type { CampaignState } from '../../campaign/types';
import type { Catalog } from '../../schema/load';
import './contractBriefing.css';

function cbills(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} C`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

export interface ContractPackage {
  payout: number;
  salvageShare: number;
}

export function ContractBriefing({
  catalog,
  state,
  missionId,
  deadlineDay,
  nodeId,
  terms,
}: {
  catalog: Catalog;
  state: CampaignState;
  missionId: string;
  deadlineDay: number;
  nodeId: string;
  terms?: ContractPackage;
}) {
  const profile = sideContractProfile(catalog, missionId);
  if (profile === null) return null;
  const commitment = contractCommitment(catalog, state, deadlineDay);
  const authored = catalog.campaigns.get(state.campaignId)?.nodes.some((entry) => entry.id === nodeId)
    ?? false;
  const days = commitment.daysRemaining === 1 ? 'day' : 'days';

  return (
    <dl className="contract-facts" data-testid="contract-facts">
      <div>
        <dt>Orders</dt>
        <dd>{profile.objectives.join(' · ')}</dd>
      </div>
      <div>
        <dt>Field</dt>
        <dd>
          {capitalise(profile.operation)} · {profile.battlefield} ·{' '}
          {formatMissionClock(profile.clockSeconds)} clock ·{' '}
          {profile.dropTonnage}t drop /{' '}
          {profile.oppositionTonnage}t rated opposition
        </dd>
      </div>
      <div>
        <dt>Calendar</dt>
        <dd>
          day {commitment.currentDay} → day {commitment.deadlineDay} ·{' '}
          {commitment.daysRemaining} {days} remaining
        </dd>
      </div>
      {terms === undefined ? null : (
        <>
          <div>
            <dt>Return</dt>
            <dd>
              {cbills(terms.payout)} on success only · {Math.round(terms.salvageShare * 100)}% salvage
              claim
            </dd>
          </div>
          <div>
            <dt>Failure</dt>
            <dd>
              {authored
                ? `${cbills(Math.round(terms.payout * catalog.rules.economy.contractFailure.recoveryCostFactor))} recovery fee + ${catalog.rules.economy.contractFailure.recoveryDays} recovery days; route reopens`
                : 'No route-recovery fee'}
              {' · '}battle damage remains the company workshop bill
            </dd>
          </div>
        </>
      )}
      <div>
        <dt>Payroll</dt>
        <dd>
          {cbills(commitment.dailyPayroll)}/day now · {cbills(commitment.wagesThroughDeadline)} maximum
          through deadline at current roster
        </dd>
      </div>
    </dl>
  );
}
