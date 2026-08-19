import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { startCampaign } from './campaign';
import { employerHistories, employerHistoryFor } from './employers';
import {
  campaignOutcomeCount,
  pruneCampaignHistory,
} from './history';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { offerPeriod, pruneSideOffers } from './sidework';
import type { CampaignState, MissionOutcome } from './types';

const CAMPAIGN_ID = 'border_dispute';
const EMPLOYERS = [
  { id: 'kestrel_combine', name: 'Kestrel Combine' },
  { id: 'halloran_freight', name: 'Halloran Freight' },
] as const;

function outcome(index: number, day: number): MissionOutcome {
  const employer = EMPLOYERS[index % EMPLOYERS.length] ?? EMPLOYERS[0];
  const won = index % 3 !== 0;
  return {
    nodeId: `side_${offerPeriod(catalog, day)}_0`,
    missionId: 'raid_ridge',
    employerId: employer.id,
    employerName: employer.name,
    termsId: 'standard',
    won,
    day,
    payout: won ? 100 + index : 0,
    salvagedChassis: [],
    salvagedItems: [],
    salvageOffered: [{ kind: 'weapon', itemId: 'medium_laser', count: 1 }],
    salvageCandidates: [],
    salvageProvenance: [],
    pilotCasualties: [],
    mechsLost: [],
    pilotReports: [],
  };
}

function expectedTotals(records: readonly MissionOutcome[], employerId: string) {
  const matching = records.filter((record) => record.employerId === employerId);
  return {
    completed: matching.filter((record) => record.won).length,
    failed: matching.filter((record) => !record.won).length,
    paid: matching.reduce((total, record) => total + record.payout, 0),
  };
}

describe('bounded campaign records', () => {
  it('plateaus across renewable boards without losing ledger or debrief facts', () => {
    const state = startCampaign(catalog, CAMPAIGN_ID, 'bounded-history');
    const campaign = catalog.campaigns.get(CAMPAIGN_ID);
    if (campaign === undefined) throw new Error('missing campaign');
    state.completedNodes.push('militia_raid');
    state.failedNodes.push('supply_line');

    const all: MissionOutcome[] = [];
    const saveSizes: number[] = [];
    const refreshDays = catalog.rules.economy.sideContracts.refreshDays;

    for (let index = 0; index < 300; index += 1) {
      state.day = index * refreshDays;
      const record = outcome(index, state.day);
      all.push(record);
      state.history.push(record);
      state.sideTaken.push(record.nodeId);
      (record.won ? state.completedNodes : state.failedNodes).push(record.nodeId);

      pruneSideOffers(catalog, state);
      pruneCampaignHistory(catalog, state);
      if (index === 99 || index === 199 || index === 299) {
        saveSizes.push(serialiseCampaign(state).length);
      }
    }

    expect(state.history).toEqual([all.at(-1)]);
    expect(state.historyArchive.outcomes).toBe(all.length - 1);
    expect(campaignOutcomeCount(state)).toBe(all.length);
    expect(state.sideTaken).toEqual([all.at(-1)?.nodeId]);
    expect(state.completedNodes).toEqual(['militia_raid']);
    expect(state.failedNodes).toEqual(['supply_line']);
    expect(Object.keys(state.historyArchive.employers)).toHaveLength(EMPLOYERS.length);
    expect(Math.max(...saveSizes) - Math.min(...saveSizes)).toBeLessThan(128);

    const histories = employerHistories(
      campaign,
      state.history,
      state.employerFailures,
      state.historyArchive.employers,
    );
    for (const employer of EMPLOYERS) {
      const expected = expectedTotals(all, employer.id);
      expect(histories.find((record) => record.id === employer.id)).toMatchObject(expected);
      expect(
        employerHistoryFor(
          campaign,
          state.history,
          employer.id,
          employer.name,
          state.employerFailures,
          state.historyArchive.employers,
        ),
      ).toMatchObject(expected);
    }

    const restored = deserialiseCampaign(serialiseCampaign(state)).state;
    expect(restored?.history.at(-1)).toEqual(all.at(-1));
    expect(restored === null ? 0 : campaignOutcomeCount(restored)).toBe(all.length);
    if (restored === null) return;
    const once = serialiseCampaign(restored);
    const twice = deserialiseCampaign(once).state;
    expect(twice === null ? null : serialiseCampaign(twice)).toBe(once);
  });

  it('defaults old saves before applying the same idempotent compaction', () => {
    const state = startCampaign(catalog, CAMPAIGN_ID, 'old-bounded-history');
    state.day = catalog.rules.economy.sideContracts.refreshDays * 3;
    const old = outcome(0, 0);
    const latest = outcome(1, state.day - 1);
    state.history.push(old, latest);
    const raw = JSON.parse(serialiseCampaign(state)) as {
      state: Partial<CampaignState>;
    };
    delete raw.state.historyArchive;

    const restored = deserialiseCampaign(JSON.stringify(raw)).state;
    expect(restored?.history).toEqual([latest]);
    expect(restored?.historyArchive).toMatchObject({ outcomes: 1 });
    expect(restored === null ? 0 : campaignOutcomeCount(restored)).toBe(2);
  });
});
