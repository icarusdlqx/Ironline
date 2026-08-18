import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { startCampaign } from './campaign';
import type { Contract, MissionOutcome } from './types';
import {
  canonicalEmployer,
  EMPLOYER_FAILURE_LIMIT,
  employerDisplayName,
  employerHistories,
  employerHistoryFor,
  employerNameFor,
  recordEmployerFailure,
} from './employers';

function outcome(values: Partial<MissionOutcome>): MissionOutcome {
  return {
    nodeId: 'militia_raid',
    missionId: 'raid_ridge',
    employerId: 'kestrel_combine',
    employerName: 'Kestrel Combine',
    termsId: 'standard',
    won: true,
    day: 1,
    payout: 100,
    salvagedChassis: [],
    salvagedItems: [],
    salvageOffered: [],
    salvageCandidates: [],
    salvageProvenance: [],
    pilotCasualties: [],
    mechsLost: [],
    pilotReports: [],
    ...values,
  };
}

describe('campaign employers', () => {
  const campaign = catalog.campaigns.get('border_dispute');
  if (campaign === undefined) throw new Error('missing campaign');

  it('canonicalises old display strings without merging distinct outfits', () => {
    expect(canonicalEmployer(campaign, '  kEsTrEl   Combine ')).toEqual({
      id: 'kestrel_combine',
      name: 'Kestrel Combine',
    });
    expect(canonicalEmployer(campaign, 'Halloran Combine').id).toBe('halloran_combine');
    expect(canonicalEmployer(campaign, 'Halloran Freight').id).toBe('halloran_freight');
    expect(canonicalEmployer(campaign, 'Sarn Foundry').id).toBe('sarn_foundry');
  });

  it('keeps an unknown old name behind a stable neutral identity', () => {
    const first = canonicalEmployer(campaign, ' Peregrine   Works ');
    const second = canonicalEmployer(campaign, 'peregrine works');

    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^legacy_peregrine_works_/);
    expect(first.name).toBe('Peregrine Works');
    expect(employerDisplayName(campaign, first.id, first.name)).toBe(
      'Independent employer — Peregrine Works',
    );
    expect(employerNameFor(catalog, campaign.id, first.id, first.name)).toBe(
      'Independent employer — Peregrine Works',
    );
  });

  it('derives completed, failed and paid totals from field and contract records', () => {
    const records = employerHistories(
      campaign,
      [
        outcome({ payout: 450 }),
        outcome({ won: false, payout: 0 }),
        outcome({
          employerId: 'halloran_freight',
          employerName: 'Halloran Freight',
          payout: 700,
        }),
      ],
      [
        {
          employerId: 'kestrel_combine',
          employerName: 'Kestrel Combine',
          day: 4,
          reason: 'withdrawn',
          count: 2,
        },
        {
          employerId: 'kestrel_combine',
          employerName: 'Kestrel Combine',
          day: 7,
          reason: 'expired',
          count: 3,
        },
      ],
    );

    expect(records.find((record) => record.id === 'kestrel_combine')).toMatchObject({
      completed: 1,
      failed: 6,
      withdrawn: 2,
      expired: 3,
      paid: 450,
    });
    expect(records.find((record) => record.id === 'halloran_freight')).toMatchObject({
      completed: 1,
      failed: 0,
      paid: 700,
    });
    expect(records.find((record) => record.id === 'sarn_foundry')).toMatchObject({
      completed: 0,
      failed: 0,
      paid: 0,
    });
    expect(employerHistoryFor(campaign, [], 'missing', 'Lost Charter').name).toBe(
      'Independent employer — Lost Charter',
    );
  });

  it('coalesces repeated dispositions before they can grow the save', () => {
    const state = startCampaign(catalog, campaign.id, 'bounded-employer-failures');
    const contract: Contract = {
      nodeId: 'militia_raid',
      missionId: 'raid_ridge',
      employerId: 'kestrel_combine',
      employerName: 'Kestrel Combine',
      termsId: 'standard',
      payout: 100,
      salvageShare: 0.5,
      acceptedOnDay: 0,
      deadlineDay: 10,
    };

    for (let index = 0; index < EMPLOYER_FAILURE_LIMIT + 50; index += 1) {
      state.day = index;
      recordEmployerFailure(catalog, state, contract, 'withdrawn');
    }

    expect(state.employerFailures).toEqual([
      expect.objectContaining({
        employerId: contract.employerId,
        reason: 'withdrawn',
        count: EMPLOYER_FAILURE_LIMIT + 50,
        day: EMPLOYER_FAILURE_LIMIT + 49,
      }),
    ]);
    expect(
      employerHistories(campaign, [], state.employerFailures).find(
        (record) => record.id === contract.employerId,
      ),
    ).toMatchObject({
      failed: EMPLOYER_FAILURE_LIMIT + 50,
      withdrawn: EMPLOYER_FAILURE_LIMIT + 50,
    });

    const capped = startCampaign(catalog, campaign.id, 'capped-employer-failures');
    for (let index = 0; index < EMPLOYER_FAILURE_LIMIT + 1; index += 1) {
      recordEmployerFailure(
        catalog,
        capped,
        {
          ...contract,
          employerId: `legacy_client_${index}`,
          employerName: `Client ${index}`,
        },
        'expired',
      );
    }
    expect(capped.employerFailures).toHaveLength(EMPLOYER_FAILURE_LIMIT);
    expect(capped.employerFailures[0]?.employerId).toBe('legacy_client_1');
    expect(capped.employerFailures.at(-1)?.employerId).toBe(
      `legacy_client_${EMPLOYER_FAILURE_LIMIT}`,
    );
  });
});
