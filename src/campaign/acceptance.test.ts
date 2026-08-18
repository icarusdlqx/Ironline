import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { computeLoadout, maximiseArmour } from '../sim/loadout';
import {
  DeploymentError,
  acceptContract,
  advanceDays,
  availableNodes,
  deployableLance,
  fillEmptySeats,
  negotiationOptions,
  prepareDeployment,
  resolveMission,
  runMission,
  startCampaign,
} from './campaign';
import { applyRefit, fitFromStore, planFit, refitInventory, stripToStore } from './refit';
import { estimateRepair, startRepair } from './repair';
import { addToStore, isPilotAvailable, storeCount, type CampaignState } from './types';
import type { BattleResult } from '../sim/world';

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

function resolveWithoutCombat(state: CampaignState, won: boolean): void {
  const contract = state.contract;
  if (contract === null) throw new Error('no active contract');
  const battle: BattleResult = {
    seed: 'campaign-transition',
    missionId: contract.missionId,
    missionStatus: won ? 'success' : 'failure',
    missionReason: won ? 'objectives-complete' : 'objectives-failed',
    objectives: [],
    ticks: 1,
    durationSeconds: 0.1,
    winner: won ? 0 : 1,
    decided: true,
    units: [],
    weapons: [],
  };
  resolveMission(catalog, state, battle, []);
}

/** Waits out the infirmary until somebody can climb into a cockpit again. */
function waitForCrew(state: CampaignState): void {
  for (let days = 0; days < 60; days += 1) {
    if (state.pilots.some((pilot) => isPilotAvailable(state, pilot))) return;
    advanceDays(catalog, state, 1);
  }
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

  it('carries battle damage through a refit instead of repairing it for free', () => {
    const mech = state.mechs.find((entry) => entry.design.mounts.length > 1);
    if (mech === undefined) return;

    const centre = mech.condition.centre_torso;
    const arm = mech.condition.left_arm;
    if (centre === undefined || arm === undefined) return;
    centre.armour = 1;
    arm.destroyed = true;
    arm.armour = 0;
    arm.internal = 0;

    const wounded = estimateRepair(catalog, mech);
    expect(wounded.cost, 'the test mech is not actually damaged').toBeGreaterThan(0);

    const stripped = stripToStore(catalog, state, mech, 0);
    expect(stripped.ok, stripped.reason ?? '').toBe(true);
    const weaponId = state.store[0]?.itemId ?? '';
    const fitted = fitFromStore(catalog, state, mech, weaponId);
    expect(fitted.ok, fitted.reason ?? '').toBe(true);

    expect(mech.condition.left_arm?.destroyed, 'the refit rebuilt a destroyed arm').toBe(true);
    expect(mech.condition.centre_torso?.armour).toBeLessThanOrEqual(1);
    expect(
      estimateRepair(catalog, mech).cost,
      'the refit wiped out the repair bill',
    ).toBeGreaterThanOrEqual(wounded.cost);
  });

  it('books a whole rebuilt design through stores in one go', () => {
    const mech = state.mechs.find((entry) => entry.design.mounts.length > 1);
    if (mech === undefined) return;

    const dropped = mech.design.mounts[0];
    if (dropped === undefined) return;
    const held = storeCount(state, 'weapon', dropped.weaponId);

    const next = JSON.parse(JSON.stringify(mech.design)) as typeof mech.design;
    next.mounts.splice(0, 1);

    const result = applyRefit(catalog, state, mech, maximiseArmour(catalog, next));
    expect(result.ok, result.reason ?? '').toBe(true);
    expect(
      storeCount(state, 'weapon', dropped.weaponId),
      'the weapon taken off never reached the shelf',
    ).toBe(held + 1);
    expect(mech.design.mounts).toHaveLength(next.mounts.length);
  });

  it('refuses a refit the company cannot pay for, and touches nothing', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;

    const next = JSON.parse(JSON.stringify(mech.design)) as typeof mech.design;
    next.mounts.push({ weaponId: 'gauss_rifle', location: 'right_arm' });

    const storeBefore = JSON.stringify(state.store);
    const designBefore = JSON.stringify(mech.design);

    const result = applyRefit(catalog, state, mech, next);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(state.store), 'a refused refit still moved stock').toBe(storeBefore);
    expect(JSON.stringify(mech.design), 'a refused refit still changed the mech').toBe(
      designBefore,
    );
  });

  it('offers the bay what is in stores plus what is already bolted on', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;
    addToStore(state, 'weapon', 'medium_laser', 2);

    const inventory = refitInventory(state, mech);
    const mounted = mech.design.mounts.filter((mount) => mount.weaponId === 'medium_laser').length;
    // Taking a gun off puts it in the player's hand, not on a shelf, so the
    // bay works from one list rather than two.
    expect(inventory.get('medium_laser')).toBe(2 + mounted);
  });

  it('refuses to strip the last weapon off a mech', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;

    while (mech.design.mounts.length > 1) {
      const result = stripToStore(catalog, state, mech, 0);
      expect(result.ok, result.reason ?? '').toBe(true);
    }

    const last = stripToStore(catalog, state, mech, 0);
    expect(last.ok).toBe(false);
    expect(last.reason).toMatch(/at least one weapon/);
    // A weaponless design fails schema validation, so the save would not reload.
    expect(mech.design.mounts).toHaveLength(1);
  });
});

describe('deployment', () => {
  it('seats a spare pilot in a mech nobody is assigned to', () => {
    const orphan = state.pilots[0];
    const wreck = state.mechs[0];
    if (orphan === undefined || wreck === undefined) return;

    // Their mech went down, so the seat is empty; a salvaged chassis has been
    // rebuilt but nobody was ever assigned to it. The company must not be left
    // holding a fit pilot and a ready mech with nothing able to deploy.
    orphan.mechId = null;
    wreck.status = 'hulk';
    const spare = JSON.parse(JSON.stringify({ ...wreck, id: 'mech-spare', status: 'ready' }));
    state.mechs.push(spare);

    const lance = deployableLance(state);
    expect(lance.some((pair) => pair.pilot.id === orphan.id && pair.mech.id === spare.id)).toBe(
      true,
    );
    expect(new Set(lance.map((pair) => pair.mech.id)).size, 'a mech was double-booked').toBe(
      lance.length,
    );

    // Reading the lance must not silently rewrite the roster.
    expect(orphan.mechId).toBeNull();
    fillEmptySeats(state);
    expect(orphan.mechId).toBe(spare.id);
  });

  it('explains itself rather than throwing a bare error when nothing can deploy', () => {
    const accepted = acceptContract(catalog, state, 'militia_raid', 0);
    expect(accepted.ok, accepted.reason ?? '').toBe(true);
    for (const mech of state.mechs) mech.status = 'hulk';

    expect(() => prepareDeployment(catalog, state)).toThrow(DeploymentError);
    expect(() => prepareDeployment(catalog, state)).toThrow(/No mech is ready to deploy/);
  });
});

describe('three-mission campaign', () => {
  // The generous timeout is headroom for a loaded CI worker, not a target: the
  // seed scan takes ~15s alone but shares the machine with every other file.
  it('completes three contracts and uses mission-one salvage in mission three', { timeout: 120_000 }, () => {
    // This is a test of the salvage-to-refit-to-field pipeline, not of whether
    // a particular lance survives a particular pair of fights. Any change to
    // the simulation reshuffles which campaigns leave a ready mech standing by
    // mission three, so the fixture scans seeds for one where the pipeline can
    // be exercised — and if no seed out of eight can, the game has become too
    // brutal to play and the test should fail loudly.
    let run: CampaignState | null = null;
    let match: { weaponId: string; host: CampaignState['mechs'][number] } | null = null;

    for (const seed of ['workshop', 'acceptance', 'salvage', 'refit', 'bay', 'depot', 'pipeline', 'quartermaster']) {
      const candidate = start(seed);
      fightNode(candidate, 'militia_raid');
      if (candidate.history[0]?.won !== true) continue;

      const crate = candidate.store.filter((item) => item.kind === 'weapon');
      if (crate.length === 0) continue;

      repairAll(candidate);
      waitForCrew(candidate);
      fightNode(candidate, 'supply_line');
      repairAll(candidate);
      waitForCrew(candidate);
      if (deployableLance(candidate).length === 0) continue;

      // Any of the salvage will do: the claim is that what the lance drags
      // home can be bolted on and FIELDED, not that the first item in the
      // crate happens to suit whichever mech walked away. The host is drawn
      // from the machines that would actually drop — a mech can be repaired
      // and still have nobody fit to fly it, and a refit on that one proves
      // nothing about fielding it.
      const fieldable = new Set(deployableLance(candidate).map((pair) => pair.mech.id));
      const found = crate
        .map((item) => ({
          weaponId: item.itemId,
          host: candidate.mechs.find(
            (mech) => fieldable.has(mech.id) && planFit(catalog, mech.design, item.itemId) !== null,
          ),
        }))
        .find((entry) => entry.host !== undefined);

      if (found?.host !== undefined) {
        run = candidate;
        match = { weaponId: found.weaponId, host: found.host };
        break;
      }
    }

    expect(match, 'no seed of eight left a ready mech that could take its salvage').not.toBeNull();
    if (run === null || match === null) return;
    const { weaponId, host } = match;
    const held = storeCount(run, 'weapon', weaponId);

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

  it('recovers from a critical loss and still reaches the victory node', () => {
    const run = start('victory');
    const sideId = availableNodes(catalog, run).find((node) => node.id.startsWith('side_'))?.id;
    const startingDay = run.day;
    const startingCash = run.cbills;

    expect(acceptContract(catalog, run, 'militia_raid', 0).ok).toBe(true);
    const recoveryCost = Math.round(
      (run.contract?.payout ?? 0) * catalog.rules.economy.contractFailure.recoveryCostFactor,
    );
    resolveWithoutCombat(run, false);

    const elapsed = 1 + catalog.rules.economy.contractFailure.recoveryDays;
    const salaries = elapsed * run.pilots.length * catalog.rules.economy.pilot.salaryPerDay;
    expect(run.finished).toBe(false);
    expect(run.day).toBe(startingDay + elapsed);
    expect(run.cbills).toBe(startingCash - recoveryCost - salaries);
    expect(availableNodes(catalog, run).map((node) => node.id)).toContain('militia_raid');
    expect(run.log[0]?.text).toMatch(/costs .* credits and 3 days.*returns to the board/);

    for (const nodeId of ['militia_raid', 'pass_skirmish', 'ridge_hold']) {
      expect(acceptContract(catalog, run, nodeId, 0).ok).toBe(true);
      resolveWithoutCombat(run, true);
    }

    expect(run.completedNodes).toEqual(
      expect.arrayContaining(['militia_raid', 'pass_skirmish', 'ridge_hold']),
    );
    expect(run.finished).toBe(true);
    expect(run.won).toBe(true);
    expect(availableNodes(catalog, run)).toEqual([]);
    expect(acceptContract(catalog, run, sideId ?? 'side_0_0', 0)).toEqual({
      ok: false,
      reason: 'the campaign is over',
    });
  });

  it('runs real battles along the three-contract victory route', { timeout: 60_000 }, () => {
    const run = start('victory');

    for (const nodeId of ['militia_raid', 'pass_skirmish', 'ridge_hold']) {
      const available = availableNodes(catalog, run).some((node) => node.id === nodeId);
      if (!available) break;
      repairAll(run);
      fightNode(run, nodeId);
    }

    expect(run.history.length).toBeGreaterThanOrEqual(2);
    expect(run.completedNodes).toHaveLength(run.history.filter((outcome) => outcome.won).length);
    expect(run.failedNodes).toHaveLength(0);

    const last = run.history[run.history.length - 1];
    if (last?.won === false) {
      expect(availableNodes(catalog, run).map((node) => node.id)).toContain(last.nodeId);
    }
  });
});
