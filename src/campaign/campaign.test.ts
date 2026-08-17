import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import {
  abandonContract,
  acceptContract,
  advanceDays,
  availableNodes,
  campaignNodes,
  deployableLance,
  dropTeam,
  dropTonnageFor,
  negotiationOptions,
  runMission,
  startCampaign,
} from './campaign';
import { estimateRepair, startRepair } from './repair';
import { availableXp, hireCost, raiseSkill, skillCost } from './roster';
import { outcomeFor } from './salvage';
import { deserialiseCampaign, serialiseCampaign } from './save';
import type { CampaignState } from './types';

const CAMPAIGN_ID = 'border_dispute';

function start(seed = 'phase4'): CampaignState {
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

let state: CampaignState;

beforeEach(() => {
  state = start();
});

describe('campaign start', () => {
  it('fields the starting lance with pilots assigned', () => {
    expect(state.mechs).toHaveLength(4);
    expect(state.pilots).toHaveLength(4);
    expect(state.pilots.every((pilot) => pilot.mechId !== null)).toBe(true);
    expect(deployableLance(state)).toHaveLength(4);
  });

  it('opens with cash and one available contract', () => {
    expect(state.cbills).toBeGreaterThan(0);
    // The war, not the hiring hall: side postings are asserted separately.
    expect(campaignNodes(catalog, state).map((node) => node.id)).toEqual(['militia_raid']);
  });

  it('rejects an unknown campaign', () => {
    expect(() => startCampaign(catalog, 'no_such_campaign', 'x')).toThrow(/unknown campaign/);
  });
});

describe('contract negotiation', () => {
  const node = catalog.campaigns.get(CAMPAIGN_ID)?.nodes[0];

  it('trades payout against salvage across the range', () => {
    if (node === undefined) throw new Error('missing node');
    const options = negotiationOptions(catalog, node);

    const first = options[0];
    const last = options[options.length - 1];
    expect(first?.salvageShare).toBe(0);
    expect(last?.salvageShare).toBeCloseTo(node.maxSalvageShare, 4);
    expect(first?.payout ?? 0).toBeGreaterThan(last?.payout ?? 0);

    for (let index = 1; index < options.length; index += 1) {
      expect(options[index]?.payout ?? 0).toBeLessThan(options[index - 1]?.payout ?? 0);
      expect(options[index]?.salvageShare ?? 0).toBeGreaterThan(
        options[index - 1]?.salvageShare ?? 0,
      );
    }
  });

  it('refuses a second contract while one is active', () => {
    expect(acceptContract(catalog, state, 'militia_raid', 0).ok).toBe(true);
    expect(acceptContract(catalog, state, 'militia_raid', 0).ok).toBe(false);
  });

  it('refuses a node whose prerequisites are unmet', () => {
    const result = acceptContract(catalog, state, 'ridge_hold', 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not available/);
  });

  it('refuses an out-of-range negotiation step', () => {
    expect(acceptContract(catalog, state, 'militia_raid', 99).ok).toBe(false);
  });

  it('marks a node failed when the deadline passes', () => {
    acceptContract(catalog, state, 'militia_raid', 0);
    const deadline = state.contract?.deadlineDay ?? 0;
    advanceDays(catalog, state, deadline - state.day + 1);

    expect(state.contract).toBeNull();
    expect(state.failedNodes).toContain('militia_raid');
  });

  it('records a withdrawal as a failure', () => {
    acceptContract(catalog, state, 'militia_raid', 0);
    abandonContract(state);
    expect(state.contract).toBeNull();
    expect(state.failedNodes).toContain('militia_raid');
  });
});

describe('mission resolution', () => {
  it('pays out and unlocks the next nodes on a win', () => {
    const before = state.cbills;
    fightNode(state, 'militia_raid');

    const outcome = state.history[0];
    expect(outcome?.won).toBe(true);
    expect(state.cbills).toBeGreaterThan(before);
    expect(state.completedNodes).toContain('militia_raid');
    expect(campaignNodes(catalog, state).map((node) => node.id).sort()).toEqual([
      'pass_skirmish',
      'supply_line',
    ]);
  });

  it('carries battle damage back onto the mech records', () => {
    fightNode(state, 'militia_raid');
    const damaged = state.mechs.filter((mech) => {
      const estimate = estimateRepair(catalog, mech);
      return estimate.armourPoints > 0 || estimate.internalPoints > 0;
    });
    expect(damaged.length).toBeGreaterThan(0);
  });

  it('awards XP to the pilots who fought', () => {
    fightNode(state, 'militia_raid');
    expect(state.pilots.some((pilot) => pilot.xp > 0)).toBe(true);
  });

  it('advances the clock', () => {
    const before = state.day;
    fightNode(state, 'militia_raid');
    expect(state.day).toBeGreaterThan(before);
  });

  it('refuses to deploy with no contract', () => {
    expect(() => runMission(catalog, state)).toThrow(/no active contract/);
  });
});

describe('salvage', () => {
  it('reads the outcome from how the mech was taken out', () => {
    const base = {
      alive: false,
      legged: false,
      pilotEjected: false,
      killMethod: 'centre_torso' as string | null,
    };
    expect(outcomeFor({ ...base } as never, true)).toBe('centre_torso');
    expect(outcomeFor({ ...base, killMethod: 'head' } as never, true)).toBe('head');
    expect(outcomeFor({ ...base, killMethod: 'ammo_explosion' } as never, true)).toBe(
      'ammo_explosion',
    );
    expect(outcomeFor({ ...base, alive: true, legged: true } as never, true)).toBe('legged');
  });

  it('leaves a surviving winner unsalvageable', () => {
    expect(
      outcomeFor({ alive: true, legged: false, pilotEjected: false, killMethod: null } as never, false),
    ).toBeNull();
  });

  it('an immobilised mech is only captured if its side lost', () => {
    const legged = { alive: true, legged: true, pilotEjected: false, killMethod: null };
    expect(outcomeFor(legged as never, true)).toBe('legged');
    expect(outcomeFor(legged as never, false)).toBeNull();
  });

  it('recovers gear into the store when salvage rights are high', () => {
    fightNode(state, 'militia_raid');
    const recovered = state.store.reduce((sum, item) => sum + item.count, 0);
    expect(recovered).toBeGreaterThan(0);
  });

  it('pays more and salvages nothing at the payout-heavy end', () => {
    const payoutRun = start('payout-run');
    acceptContract(catalog, payoutRun, 'militia_raid', 0);
    runMission(catalog, payoutRun);

    expect(payoutRun.store).toHaveLength(0);
    expect(payoutRun.history[0]?.salvagedChassis ?? []).toHaveLength(0);
  });
});

describe('repair queue', () => {
  it('costs credits and days, then returns the mech to ready', () => {
    fightNode(state, 'militia_raid');

    const mech = state.mechs.find((entry) => estimateRepair(catalog, entry).days > 0);
    expect(mech).toBeDefined();
    if (mech === undefined) return;

    const estimate = estimateRepair(catalog, mech);
    const cash = state.cbills;

    const result = startRepair(catalog, state, mech);
    expect(result.ok, result.reason ?? '').toBe(true);
    expect(state.cbills).toBe(cash - estimate.cost);
    expect(mech.status).toBe('repairing');

    advanceDays(catalog, state, estimate.days);
    expect(mech.status).toBe('ready');
    expect(estimateRepair(catalog, mech).days).toBe(0);
  });

  it('refuses to repair an undamaged mech', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;
    expect(startRepair(catalog, state, mech).ok).toBe(false);
  });

  it('charges to put the back plate on again, and hangs it back where it was', () => {
    const mech = state.mechs[0];
    if (mech === undefined) return;

    const stripped = mech.condition.centre_torso.rearArmour;
    expect(stripped).toBeGreaterThan(0);
    mech.condition.centre_torso.rearArmour = 0;

    expect(estimateRepair(catalog, mech).armourPoints).toBe(stripped);

    const cash = state.cbills;
    expect(startRepair(catalog, state, mech).ok).toBe(true);
    expect(state.cbills).toBeLessThan(cash);

    advanceDays(catalog, state, estimateRepair(catalog, mech).days + 1);

    // Rebuilt as a split, not piled onto the front.
    const core = mech.condition.centre_torso;
    expect(core.rearArmour).toBe(stripped);
    expect(core.armour + core.rearArmour).toBe(mech.design.armour.centre_torso);
  });

  it('refuses a repair the company cannot afford', () => {
    fightNode(state, 'militia_raid');
    const mech = state.mechs.find((entry) => estimateRepair(catalog, entry).days > 0);
    if (mech === undefined) return;

    state.cbills = 0;
    const result = startRepair(catalog, state, mech);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/repair costs/);
  });
});

describe('pilot progression', () => {
  it('spends XP on skills at an escalating cost', () => {
    const pilot = state.pilots[0];
    if (pilot === undefined) return;

    const cost = skillCost(catalog, pilot.gunnery);
    expect(skillCost(catalog, pilot.gunnery + 1)).toBeGreaterThan(cost);

    expect(raiseSkill(catalog, pilot, 'gunnery').ok).toBe(false);

    pilot.xp = cost;
    const gunnery = pilot.gunnery;
    const result = raiseSkill(catalog, pilot, 'gunnery');
    expect(result.ok).toBe(true);
    expect(pilot.gunnery).toBe(gunnery + 1);
    expect(availableXp(pilot)).toBe(0);
  });

  it('will not raise a skill past five', () => {
    const pilot = state.pilots[0];
    if (pilot === undefined) return;
    pilot.gunnery = 5;
    pilot.xp = 1_000_000;
    expect(raiseSkill(catalog, pilot, 'gunnery').ok).toBe(false);
  });

  it('prices a hire by skill', () => {
    const green = { id: 'a', name: 'A', gunnery: 1, piloting: 1, sensors: 1, traits: [], bio: '' };
    const veteran = { id: 'b', name: 'B', gunnery: 4, piloting: 4, sensors: 4, traits: [], bio: '' };
    expect(hireCost(catalog, veteran)).toBeGreaterThan(hireCost(catalog, green));
  });
});

describe('save and load', () => {
  it('round-trips a fresh campaign exactly', () => {
    const restored = deserialiseCampaign(serialiseCampaign(state));
    expect(restored.error).toBeNull();
    expect(restored.state).toEqual(state);
  });

  it('round-trips a campaign in progress exactly', () => {
    fightNode(state, 'militia_raid');
    const mech = state.mechs.find((entry) => estimateRepair(catalog, entry).days > 0);
    if (mech !== undefined) startRepair(catalog, state, mech);
    acceptContract(catalog, state, 'pass_skirmish', 3);

    const restored = deserialiseCampaign(serialiseCampaign(state));
    expect(restored.error).toBeNull();
    expect(restored.state).toEqual(state);
  });

  // Fights a whole mission twice over to compare the streams.
  it('resumes the same random stream after a reload', { timeout: 30_000 }, () => {
    fightNode(state, 'militia_raid');

    const reloaded = deserialiseCampaign(serialiseCampaign(state)).state;
    expect(reloaded).not.toBeNull();
    if (reloaded === null) return;

    acceptContract(catalog, state, 'pass_skirmish', 4);
    acceptContract(catalog, reloaded, 'pass_skirmish', 4);
    runMission(catalog, state);
    runMission(catalog, reloaded);

    expect(reloaded).toEqual(state);
  });

  it('rejects a corrupt save', () => {
    expect(deserialiseCampaign('{').error).toMatch(/not valid JSON/);
    expect(deserialiseCampaign('{"version":1}').error).not.toBeNull();
    expect(deserialiseCampaign(JSON.stringify({ version: 99, state })).error).not.toBeNull();
  });
});

describe('drop allowance', () => {
  it('reads the allowance the mission states', () => {
    const raid = catalog.missions.get('raid_ridge');
    expect(dropTonnageFor(catalog, 'raid_ridge')).toBe(raid?.dropTonnage);
  });

  it('falls back to the lance a mission fields when nobody stated one', () => {
    // Missions are content; one that predates the allowance must still be
    // playable, and the honest default is what it fields itself.
    const mission = catalog.missions.get('skirmish_ridge');
    if (mission === undefined) throw new Error('missing mission');
    const own = (mission.lances.find((lance) => lance.team === 0)?.units ?? []).reduce(
      (total, unit) =>
        total +
        (catalog.chassis.get(catalog.designs.get(unit.designId)?.chassisId ?? '')?.tonnage ?? 0),
      0,
    );
    const stripped = { ...mission, dropTonnage: null };
    const stubbed = {
      ...catalog,
      missions: new Map([...catalog.missions, ['skirmish_ridge', stripped]]),
    } as typeof catalog;
    expect(dropTonnageFor(stubbed, 'skirmish_ridge')).toBe(own);
  });

  it('leaves a mech behind rather than exceeding the allowance', () => {
    const state = startCampaign(catalog, 'border_dispute', 'weight');
    const heavy = state.mechs[0];
    const pilot = state.pilots[0];
    if (heavy === undefined || pilot === undefined) throw new Error('empty company');

    // One machine that eats most of the allowance on its own.
    const colossus = catalog.designs.get('colossus_siege');
    if (colossus === undefined) throw new Error('missing design');
    heavy.design = JSON.parse(JSON.stringify(colossus)) as typeof colossus;

    const team = dropTeam(catalog, state, 'raid_ridge');
    const carried = team.reduce(
      (total, pair) => total + (catalog.chassis.get(pair.mech.design.chassisId)?.tonnage ?? 0),
      0,
    );

    expect(carried).toBeLessThanOrEqual(dropTonnageFor(catalog, 'raid_ridge'));
    expect(team.length, 'the whole company still deployed').toBeLessThan(state.mechs.length);
  });
});
