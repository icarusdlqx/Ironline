import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { BattleResult } from '../sim/world';
import {
  abandonContract,
  acceptContract,
  advanceDays,
  resolveMission,
  startCampaign,
} from './campaign';
import { employerById, employerHistories } from './employers';
import { sideContracts } from './sidework';

function result(missionId: string, won: boolean): BattleResult {
  return {
    seed: 'employer-contract',
    missionId,
    missionStatus: won ? 'success' : 'failure',
    missionReason: won ? 'objectives-complete' : 'objectives-failed',
    objectives: [],
    ticks: 1,
    durationSeconds: 0.05,
    winner: won ? 0 : 1,
    decided: true,
    units: [],
    weapons: [],
  };
}

describe('employer contract records', () => {
  it('carries an authored employer from the offer through the outcome', () => {
    const state = startCampaign(catalog, 'border_dispute', 'authored-employer');
    const campaign = catalog.campaigns.get(state.campaignId);
    const node = campaign?.nodes.find((entry) => entry.id === 'militia_raid');
    if (campaign === undefined || node === undefined) throw new Error('missing opening contract');
    const employer = employerById(campaign, node.employerId);

    expect(acceptContract(catalog, state, node.id, 'standard').ok).toBe(true);
    expect(state.contract).toMatchObject({
      employerId: employer.id,
      employerName: employer.name,
    });
    const run = resolveMission(catalog, state, result(node.missionId, true), []);
    expect(run.outcome).toMatchObject({ employerId: employer.id, employerName: employer.name });
  });

  it('uses the same stable employer on a side posting and its result', () => {
    const state = startCampaign(catalog, 'border_dispute', 'side-employer');
    const campaign = catalog.campaigns.get(state.campaignId);
    const offer = sideContracts(catalog, state)[0];
    if (campaign === undefined || offer === undefined) throw new Error('missing side contract');
    const employer = employerById(campaign, offer.employerId);

    expect(acceptContract(catalog, state, offer.id, 'fee_first').ok).toBe(true);
    expect(state.contract?.employerId).toBe(offer.employerId);
    const run = resolveMission(catalog, state, result(offer.missionId, false), []);
    expect(run.outcome).toMatchObject({ employerId: employer.id, employerName: employer.name });
  });

  it('counts withdrawals and expiries as factual contract failures', () => {
    const withdrawn = startCampaign(catalog, 'border_dispute', 'employer-withdrawn');
    acceptContract(catalog, withdrawn, 'militia_raid', 'standard');
    const employerId = withdrawn.contract?.employerId;
    abandonContract(catalog, withdrawn);

    const expired = startCampaign(catalog, 'border_dispute', 'employer-expired');
    acceptContract(catalog, expired, 'militia_raid', 'standard');
    const deadline = expired.contract?.deadlineDay;
    if (employerId === undefined || deadline === undefined) throw new Error('contract not signed');
    advanceDays(catalog, expired, deadline - expired.day + 1);

    expect(withdrawn.employerFailures).toEqual([
      expect.objectContaining({ employerId, reason: 'withdrawn' }),
    ]);
    expect(expired.employerFailures).toEqual([
      expect.objectContaining({ employerId, reason: 'expired' }),
    ]);
    const campaign = catalog.campaigns.get(withdrawn.campaignId);
    if (campaign === undefined) throw new Error('campaign missing');
    const histories = employerHistories(campaign, [], [
      ...withdrawn.employerFailures,
      ...expired.employerFailures,
    ]);
    expect(histories.find((entry) => entry.id === employerId)).toMatchObject({
      failed: 2,
      withdrawn: 1,
      expired: 1,
    });
  });
});
