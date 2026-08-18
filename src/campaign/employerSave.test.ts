import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { BattleResult } from '../sim/world';
import { acceptContract, resolveMission, startCampaign } from './campaign';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { sideContracts } from './sidework';

interface EmployerFields {
  employer?: string;
  employerId?: string;
  employerName?: string;
  nodeId?: string;
  missionId?: string;
}

function battle(missionId: string): BattleResult {
  return {
    seed: 'old-employer-save',
    missionId,
    missionStatus: 'success',
    missionReason: 'objectives-complete',
    objectives: [],
    ticks: 1,
    durationSeconds: 0.05,
    winner: 0,
    decided: true,
    units: [],
    weapons: [],
  };
}

function stripIdentity(record: EmployerFields): void {
  delete record.employerId;
  delete record.employerName;
}

describe('employer save migration', () => {
  it('canonicalises an old active-contract display name', () => {
    const state = startCampaign(catalog, 'border_dispute', 'old-active-employer');
    acceptContract(catalog, state, 'militia_raid', 'standard');
    const raw = JSON.parse(serialiseCampaign(state)) as {
      state: { contract: EmployerFields | null };
    };
    if (raw.state.contract === null) throw new Error('contract was not signed');
    stripIdentity(raw.state.contract);
    raw.state.contract.employer = '  kestrel   COMBINE ';

    const restored = deserialiseCampaign(JSON.stringify(raw), catalog);
    expect(restored.error).toBeNull();
    expect(restored.state?.contract).toMatchObject({
      employerId: 'kestrel_combine',
      employerName: 'Kestrel Combine',
    });
    expect(restored.state?.seed).toBe(state.seed);
    expect(restored.state?.rng).toEqual(state.rng);
  });

  it('recovers an old authored outcome from its campaign node', () => {
    const state = startCampaign(catalog, 'border_dispute', 'old-authored-employer');
    acceptContract(catalog, state, 'militia_raid', 'standard');
    const contract = state.contract;
    if (contract === null) throw new Error('contract was not signed');
    resolveMission(catalog, state, battle(contract.missionId), []);
    const raw = JSON.parse(serialiseCampaign(state)) as {
      state: { history: EmployerFields[] };
    };
    const record = raw.state.history[0];
    if (record === undefined) throw new Error('outcome was not recorded');
    stripIdentity(record);

    const restored = deserialiseCampaign(JSON.stringify(raw), catalog);
    expect(restored.state?.history[0]).toMatchObject({
      employerId: 'kestrel_combine',
      employerName: 'Kestrel Combine',
    });
  });

  it('replays an old side-work posting to recover its signed client', () => {
    const state = startCampaign(catalog, 'border_dispute', 'old-side-employer');
    const offer = sideContracts(catalog, state)[0];
    if (offer === undefined) throw new Error('missing side contract');
    acceptContract(catalog, state, offer.id, 'standard');
    resolveMission(catalog, state, battle(offer.missionId), []);
    const raw = JSON.parse(serialiseCampaign(state)) as {
      state: { history: EmployerFields[] };
    };
    const record = raw.state.history[0];
    if (record === undefined) throw new Error('outcome was not recorded');
    stripIdentity(record);

    const restored = deserialiseCampaign(JSON.stringify(raw), catalog);
    expect(restored.state?.history[0]).toMatchObject({
      employerId: offer.employerId,
      employerName:
        catalog.campaigns
          .get(state.campaignId)
          ?.employers.find((entry) => entry.id === offer.employerId)?.name,
    });
  });

  it('does not assign a client to an invalid legacy side posting', () => {
    const state = startCampaign(catalog, 'border_dispute', 'invalid-side-employer');
    const offer = sideContracts(catalog, state)[0];
    if (offer === undefined) throw new Error('missing side contract');
    acceptContract(catalog, state, offer.id, 'standard');
    resolveMission(catalog, state, battle(offer.missionId), []);
    const source = JSON.parse(serialiseCampaign(state)) as {
      state: { history: EmployerFields[] };
    };
    const record = source.state.history[0];
    if (record === undefined) throw new Error('outcome was not recorded');
    stripIdentity(record);

    const invalid = [
      { nodeId: 'side_00_0' },
      { nodeId: 'side_9007199254740992_0' },
      { nodeId: 'side_0_3' },
      { missionId: 'training_ground' },
    ];
    for (const fields of invalid) {
      const raw = structuredClone(source);
      Object.assign(raw.state.history[0] ?? {}, fields);
      expect(deserialiseCampaign(JSON.stringify(raw), catalog).state?.history[0]).toMatchObject({
        employerId: 'unknown_employer',
        employerName: 'Independent employer',
      });
    }
  });

  it('gives old saves an empty employer-failure register', () => {
    const state = startCampaign(catalog, 'border_dispute', 'old-employer-failures');
    const raw = JSON.parse(serialiseCampaign(state)) as {
      state: { employerFailures?: unknown };
    };
    delete raw.state.employerFailures;

    expect(deserialiseCampaign(JSON.stringify(raw), catalog).state?.employerFailures).toEqual([]);
  });

  it('preserves an unknown old label under a deterministic neutral id', () => {
    const state = startCampaign(catalog, 'border_dispute', 'unknown-employer');
    acceptContract(catalog, state, 'militia_raid', 'standard');
    const raw = JSON.parse(serialiseCampaign(state)) as {
      state: { contract: EmployerFields | null };
    };
    if (raw.state.contract === null) throw new Error('contract was not signed');
    stripIdentity(raw.state.contract);
    raw.state.contract.employer = 'Peregrine Works';

    const restored = deserialiseCampaign(JSON.stringify(raw), catalog);
    expect(restored.state?.contract?.employerId).toMatch(/^legacy_peregrine_works_/);
    expect(restored.state?.contract?.employerName).toBe('Peregrine Works');
    if (restored.state === null) throw new Error('old campaign did not load');
    expect(
      deserialiseCampaign(serialiseCampaign(restored.state), catalog).state?.contract,
    ).toEqual(restored.state?.contract);
  });
});
