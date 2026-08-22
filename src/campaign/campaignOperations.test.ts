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
  runMission,
  startCampaign,
} from './campaign';
import { applyRefit, fitFromStore, refitInventory, stripToStore } from './refit';
import { estimateRepair, startRepair } from './repair';
import { availableXp, raiseSkill, skillCost, SKILLS } from './roster';
import { startFreshCampaign } from './freshness';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { sideContracts } from './sidework';
import { addToStore, isPilotAvailable, storeCount, type CampaignState } from './types';

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

  const accepted = acceptContract(catalog, state, nodeId, salvageHeavy.id);
  expect(accepted.ok, accepted.reason ?? '').toBe(true);
  runMission(catalog, state);
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

describe('campaign freshness', () => {
  it('rebuilds a persisted hiring hall from its visible run code', () => {
    let saved = '';
    const fresh = startFreshCampaign(
      catalog,
      CAMPAIGN_ID,
      () => 'shale-picket-13579bdf',
      (next) => { saved = serialiseCampaign(next); },
    );
    const restored = deserialiseCampaign(saved).state;

    expect(restored?.seed).toBe('shale-picket-13579bdf');
    expect(restored === null ? [] : sideContracts(catalog, restored)).toEqual(
      sideContracts(catalog, fresh),
    );
  });
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
    const after = estimateRepair(catalog, mech);
    expect(after.destroyedLocations).toContain('left_arm');
    expect(after.internalPoints).toBeGreaterThanOrEqual(wounded.internalPoints);
    expect(after.cost, 'the refit wiped out the repair bill').toBeGreaterThan(0);
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

  it('books heat-sink changes through stores like every other component', () => {
    const mech = state.mechs.find((entry) => {
      const candidate = JSON.parse(JSON.stringify(entry.design)) as typeof entry.design;
      candidate.heatSinkId = 'double_heat_sink';
      return computeLoadout(catalog, candidate).valid;
    });
    expect(mech, 'starting lance has no legal Compound Heat Sink refit').toBeDefined();
    if (mech === undefined) return;

    const inventory = refitInventory(state, mech);
    expect(inventory.get(mech.design.heatSinkId)).toBe(mech.design.heatSinks);
    expect(inventory.get('double_heat_sink')).toBeUndefined();

    const next = JSON.parse(JSON.stringify(mech.design)) as typeof mech.design;
    next.heatSinkId = 'double_heat_sink';
    const refused = applyRefit(catalog, state, mech, next);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/Compound Heat Sink/);

    addToStore(state, 'equipment', 'double_heat_sink', next.heatSinks);
    const accepted = applyRefit(catalog, state, mech, next);
    expect(accepted.ok, accepted.reason ?? '').toBe(true);
    expect(storeCount(state, 'equipment', 'double_heat_sink')).toBe(0);
    expect(storeCount(state, 'equipment', 'heat_sink')).toBe(next.heatSinks);
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
  it('keeps a contract seed exact across a save round trip', () => {
    const accepted = acceptContract(catalog, state, 'militia_raid', 'fee_first');
    expect(accepted.ok, accepted.reason ?? '').toBe(true);
    const before = prepareDeployment(catalog, state);
    const restored = deserialiseCampaign(serialiseCampaign(state)).state;
    if (restored === null) throw new Error('campaign save did not reload');

    expect(before.seed).toBe(`${state.seed}:militia_raid:${state.day}`);
    expect(prepareDeployment(catalog, restored).seed).toBe(before.seed);
  });

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
    const accepted = acceptContract(catalog, state, 'militia_raid', 'fee_first');
    expect(accepted.ok, accepted.reason ?? '').toBe(true);
    for (const mech of state.mechs) mech.status = 'hulk';

    expect(() => prepareDeployment(catalog, state)).toThrow(DeploymentError);
    expect(() => prepareDeployment(catalog, state)).toThrow(/No mech is ready to deploy/);
  });
});

describe('pilot progression', () => {
  it('banks a real drop award, accepts one chosen skill, and saves it', () => {
    fightNode(state, 'militia_raid');
    expect(state.history[0]?.won).toBe(true);
    repairAll(state);
    waitForCrew(state);
    fightNode(state, 'supply_line');

    expect(state.pilots.every((pilot) => pilot.spentXp === 0)).toBe(true);
    const trainee = state.pilots.find(
      (pilot) =>
        !pilot.dead &&
        SKILLS.some((skill) => availableXp(pilot) >= skillCost(catalog, pilot[skill])),
    );
    expect(
      trainee,
      `nobody could train after the opening drop: ${state.pilots.map((pilot) => availableXp(pilot)).join(', ')}`,
    ).toBeDefined();
    if (trainee === undefined) return;

    const report = [...state.history]
      .reverse()
      .flatMap((outcome) => outcome.pilotReports)
      .find((entry) => entry.pilotId === trainee.id);
    expect(report?.xpBanked).toBe(availableXp(trainee));
    const chosen = SKILLS.find(
      (skill) => availableXp(trainee) >= skillCost(catalog, trainee[skill]),
    );
    if (chosen === undefined) throw new Error('the trainable pilot has no affordable skill');
    const before = trainee[chosen];

    expect(raiseSkill(catalog, trainee, chosen).ok).toBe(true);
    const restored = deserialiseCampaign(serialiseCampaign(state)).state;
    expect(restored?.pilots.find((pilot) => pilot.id === trainee.id)?.[chosen]).toBe(before + 1);
  });
});
