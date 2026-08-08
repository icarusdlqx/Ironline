import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { computeLoadout } from '../sim/loadout';
import {
  acceptContract,
  advanceDays,
  availableNodes,
  deployableLance,
  negotiationOptions,
  runMission,
  startCampaign,
} from './campaign';
import { fitFromStore, planFit, stripToStore } from './refit';
import { estimateRepair, startRepair } from './repair';
import { storeCount, type CampaignState } from './types';

const CAMPAIGN_ID = 'border_dispute';

function start(seed: string): CampaignState {
  return startCampaign(catalog, CAMPAIGN_ID, seed);
}

/** Accepts the most salvage-heavy terms available on a node and fights it. */
function fightNode(state: CampaignState, nodeId: string): void {
  const node = availableNodes(catalog, state).find((entry) => entry.id === nodeId);
  if (node === undefined) throw new Error(`node ${nodeId} is not available`);

  const options = negotiationOptions(catalog, node);
  const salvageHeavy = options[options.length - 1];
  if (salvageHeavy === undefined) throw new Error('no negotiation options');

  const accepted = acceptContract(catalog, state, nodeId, salvageHeavy.step);
  expect(accepted.ok, accepted.reason ?? '').toBe(true);
  runMission(catalog, state);
}

/** Books every affordable repair and waits for the bay to clear. */
function repairAll(state: CampaignState): void {
  for (const mech of state.mechs) {
    if (mech.status === 'hulk') continue;
    const estimate = estimateRepair(catalog, mech);
    if (estimate.days > 0 && estimate.cost <= state.cbills) startRepair(catalog, state, mech);
  }

  const longest = state.mechs.reduce(
    (days, mech) =>
      mech.status === 'repairing' ? Math.max(days, mech.readyOnDay - state.day) : days,
    0,
  );
  if (longest > 0) advanceDays(catalog, state, longest);
}

let state: CampaignState;

beforeEach(() => {
  state = start('refit');
});

describe('refit', () => {
  it('moves a weapon from stores onto a mech and back', () => {
    const mech = state.mechs.find((entry) => entry.design.chassisId === 'bulwark_bwk3');
    if (mech === undefined) return;

    const before = mech.design.mounts.length;
    const stripped = stripToStore(catalog, state, mech, 0);
    expect(stripped.ok, stripped.reason ?? '').toBe(true);
    expect(mech.design.mounts).toHaveLength(before - 1);

    const weaponId = state.store[0]?.itemId ?? '';
    const fitted = fitFromStore(catalog, state, mech, weaponId);
    expect(fitted.ok, fitted.reason ?? '').toBe(true);
    expect(mech.design.mounts).toHaveLength(before);
    expect(computeLoadout(catalog, mech.design).valid).toBe(true);
  });

  it('refuses to fit something the company does not have', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;
    const result = fitFromStore(catalog, state, mech, 'medium_laser');
    expect(result.ok).toBe(false);
  });

  it('refuses to refit a mech that is in the bay', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;
    mech.status = 'repairing';
    expect(fitFromStore(catalog, state, mech, 'medium_laser').reason).toMatch(/repair bay/);
  });
});

describe('three-mission campaign', () => {
  it('completes three contracts and uses mission-one salvage in mission three', () => {
    const run = start('acceptance');

    fightNode(run, 'militia_raid');
    expect(run.history[0]?.won, 'mission one was lost').toBe(true);

    const salvaged = run.store.filter((item) => item.kind === 'weapon');
    expect(salvaged.length, 'mission one produced no salvaged weapons').toBeGreaterThan(0);
    const weaponId = salvaged[0]?.itemId ?? '';

    repairAll(run);
    fightNode(run, 'supply_line');
    repairAll(run);

    // Fit the mission-one salvage to a mech, then take that mech into mission three.
    const held = storeCount(run, 'weapon', weaponId);
    const host = run.mechs.find(
      (mech) => mech.status === 'ready' && planFit(catalog, mech.design, weaponId) !== null,
    );
    expect(host, `no ready mech could take a salvaged ${weaponId}`).toBeDefined();
    if (host === undefined) return;

    const refit = fitFromStore(catalog, run, host, weaponId);
    expect(refit.ok, refit.reason ?? '').toBe(true);
    expect(storeCount(run, 'weapon', weaponId)).toBe(held - 1);
    expect(computeLoadout(catalog, host.design).valid, 'the refit is not a legal build').toBe(true);

    const deployed = deployableLance(run).map((pair) => pair.mech.id);
    expect(deployed, 'the refitted mech is not in the deployable lance').toContain(host.id);

    fightNode(run, 'pass_skirmish');

    expect(run.history, 'three contracts were not fought').toHaveLength(3);
    expect(run.completedNodes.length, 'no contract was completed').toBeGreaterThanOrEqual(2);
    expect(
      host.design.mounts.some((mount) => mount.weaponId === weaponId),
      'the salvaged weapon is not on the mech that fought mission three',
    ).toBe(true);
  });

  it('is winnable to the victory node', () => {
    const run = start('victory');

    for (const nodeId of ['militia_raid', 'pass_skirmish', 'ridge_hold']) {
      const available = availableNodes(catalog, run).some((node) => node.id === nodeId);
      if (!available) break;
      repairAll(run);
      fightNode(run, nodeId);
    }

    expect(run.history.length).toBeGreaterThanOrEqual(2);
    expect(run.completedNodes.length + run.failedNodes.length).toBe(run.history.length);
  });
});
