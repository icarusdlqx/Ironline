import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { computeLoadout } from '../sim/loadout';
import type { BattleResult } from '../sim/world';
import {
  acceptContract,
  advanceDays,
  availableNodes,
  deployableLance,
  negotiationOptions,
  resolveMission,
  runMission,
  startCampaign,
} from './campaign';
import { sellMech, storeItemSaleBasis, storeItemValueOf } from './market';
import { employerHistories } from './employers';
import { campaignOutcomeCount } from './history';
import { fitFromStore, planFit, rebuildHulk } from './refit';
import { estimateRepair, startRepair } from './repair';
import { assessSolvency, retireCompany } from './solvency';
import {
  isPilotAvailable,
  storeCount,
  type CampaignState,
  type MissionOutcome,
} from './types';

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

function expectRecoveryLedger(record: MissionOutcome): void {
  expect(record.salvageCandidates.length).toBeGreaterThan(0);
  expect(record.salvageCandidates.every((entry) => entry.chassisChance >= 0)).toBe(true);
  expect(record.salvageCandidates.every((entry) => entry.chassisChance <= 1)).toBe(true);
  expect(record.salvageCandidates.filter((entry) => entry.recovered).map((entry) => entry.designId))
    .toEqual(record.salvagedChassis);

  for (const item of record.salvageOffered) {
    const sources = record.salvageProvenance.filter(
      (source) => source.kind === item.kind && source.itemId === item.itemId,
    );
    expect(sources, `${item.itemId} lost its field source`).toHaveLength(item.count);
    for (const source of sources) {
      const design = catalog.designs.get(source.sourceDesignId);
      const fitted =
        source.kind === 'weapon'
          ? design?.mounts.some(
              (mount) => mount.weaponId === source.itemId && mount.location === source.location,
            )
          : design?.equipment.some(
              (fit) => fit.equipmentId === source.itemId && fit.location === source.location,
            );
      expect(fitted, `${item.itemId} source is not fitted at ${source.location}`).toBe(true);
    }
  }
}

describe('campaign contracts', () => {
  // The generous timeout is headroom for a loaded CI worker, not a target: the
  // seed scan takes ~15s alone but shares the machine with every other file.
  it('completes three contracts and uses mission-one salvage in mission three', { timeout: 120_000 }, () => {
    // This is a test of the salvage-to-refit-to-field pipeline, not of whether
    // a particular lance survives a particular pair of fights. Any change to
    // the simulation reshuffles which campaigns leave a ready mech standing by
    // mission three, so the fixture scans seeds for one where the pipeline can
    // be exercised — and if no seed in this bounded set can, the game has become too
    // brutal to play and the test should fail loudly.
    let run: CampaignState | null = null;
    let match: { weaponId: string; host: CampaignState['mechs'][number] } | null = null;

    for (const seed of [
      'phase4-pipeline-6', 'withdrawal-4', 'workshop', 'acceptance', 'salvage', 'refit', 'bay',
      'depot', 'pipeline', 'quartermaster',
    ]) {
      const candidate = start(seed);
      fightNode(candidate, 'militia_raid');
      if (candidate.history[0]?.won !== true) continue;

      const crate = candidate.store.filter((item) => item.kind === 'weapon');
      if (crate.length === 0) continue;
      expectRecoveryLedger(candidate.history[0]);
      for (const item of candidate.history[0]?.salvageOffered ?? []) {
        expect(storeItemValueOf(catalog, item), `${item.itemId} has no build value`).toBeGreaterThan(0);
        expect(storeItemSaleBasis(catalog, item), `${item.itemId} has no mounted sale basis`).toBeGreaterThan(0);
        expect(storeItemSaleBasis(catalog, item)).toBeLessThanOrEqual(storeItemValueOf(catalog, item));
      }

      repairAll(candidate);
      waitForCrew(candidate);
      fightNode(candidate, 'supply_line');
      if (candidate.history[1]?.won !== true) continue;
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

    expect(match, 'no bounded seed left a ready mech that could take its salvage').not.toBeNull();
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

    expect(campaignOutcomeCount(run), 'three contracts were not fought').toBe(3);
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

    expect(acceptContract(catalog, run, 'militia_raid', 'fee_first').ok).toBe(true);
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
    expect(run.log.some((entry) => /costs .* credits and 3 days.*returns to the board/.test(entry.text))).toBe(true);

    const route = [
      'militia_raid',
      'pass_skirmish',
      'foundry_sweep_node',
      'shale_overwatch_node',
      'ridge_hold',
      'depot_burn',
    ];
    for (const nodeId of route) {
      expect(acceptContract(catalog, run, nodeId, 'fee_first').ok).toBe(true);
      resolveWithoutCombat(run, true);
    }

    expect(run.completedNodes).toEqual(expect.arrayContaining(route));
    const campaign = catalog.campaigns.get(CAMPAIGN_ID);
    if (campaign === undefined) throw new Error('missing campaign');
    const employers = employerHistories(
      campaign,
      run.history,
      run.employerFailures,
      run.historyArchive.employers,
    );
    expect(employers.find((record) => record.id === 'halloran_freight')).toMatchObject({
      completed: 4,
      failed: 1,
    });
    expect(employers.find((record) => record.id === 'sarn_foundry')).toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(employers.find((record) => record.id === 'ridgeward_assembly')).toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(employers.reduce((paid, record) => paid + record.paid, 0)).toBe(
      Object.values(run.historyArchive.employers).reduce(
        (paid, summary) => paid + summary.paid,
        run.history.reduce((paid, outcome) => paid + outcome.payout, 0),
      ),
    );
    expect(run.finished).toBe(true);
    expect(run.won).toBe(true);
    expect(availableNodes(catalog, run)).toEqual([]);
    expect(acceptContract(catalog, run, sideId ?? 'side_0_0', 'fee_first')).toEqual({
      ok: false,
      reason: 'the campaign is over',
    });
  });

  // The graph test proves reachability. This keeps the authored sequence wired
  // to real battles, where a fixed company may lose before the route is done.
  it('plays the authored victory line with live mission resolution', { timeout: 60_000 }, () => {
    const run = start('victory');
    const route = [
      'militia_raid',
      'pass_skirmish',
      'foundry_sweep_node',
      'shale_overwatch_node',
      'ridge_hold',
      'depot_burn',
    ];

    for (const nodeId of route) {
      const available = availableNodes(catalog, run).some((node) => node.id === nodeId);
      if (!available) break;
      repairAll(run);
      fightNode(run, nodeId);
    }

    const fought = campaignOutcomeCount(run);
    expect(fought).toBeGreaterThanOrEqual(2);
    const last = run.history.at(-1);
    expect(last?.nodeId).toBe(route[fought - 1]);
    expect(run.completedNodes).toEqual(
      route.slice(0, fought - (last?.won === false ? 1 : 0)),
    );
    expect(run.failedNodes).toHaveLength(0);

    if (last?.won === false) {
      expect(availableNodes(catalog, run).map((node) => node.id)).toContain(last.nodeId);
    }
  });

  it('liquidates surplus wrecks and fields the retained hull', () => {
    const run = start('solvency-rebuild');
    for (const mech of run.mechs) {
      mech.status = 'hulk';
      mech.rebuildCost = 100_000;
    }
    run.cbills = 0;

    const report = assessSolvency(catalog, run);
    expect(report).toMatchObject({
      state: 'fundable',
      plan: { needsSale: true, mechNeedsRebuild: true },
    });
    const retained = run.mechs.find((mech) => mech.id === report.plan?.mechId);
    if (retained === undefined) throw new Error('reported recovery hull is missing');

    for (const mech of [...run.mechs]) {
      if (mech.id !== retained.id) expect(sellMech(catalog, run, mech.id).ok).toBe(true);
    }
    expect(run.cbills).toBeGreaterThanOrEqual(retained.rebuildCost);
    expect(rebuildHulk(catalog, run, retained).ok).toBe(true);
    advanceDays(catalog, run, retained.readyOnDay - run.day);

    expect(deployableLance(run)).toHaveLength(1);
    expect(assessSolvency(catalog, run).state).toBe('fieldable');
    expect(availableNodes(catalog, run).length).toBeGreaterThan(0);
  });

  it('ends only when an unfundable company confirms retirement', () => {
    const run = start('solvency-retirement');
    const last = run.mechs[0];
    if (last === undefined) throw new Error('campaign has no mech');
    run.mechs = [last];
    last.status = 'hulk';
    last.rebuildCost = 500_000;
    run.cbills = -1;

    expect(assessSolvency(catalog, run).state).toBe('terminal');
    expect(retireCompany(catalog, run)).toEqual({ ok: true, reason: null });
    expect(run).toMatchObject({ finished: true, won: false });
    expect(availableNodes(catalog, run)).toEqual([]);
    expect(acceptContract(catalog, run, 'militia_raid', 'fee_first')).toEqual({
      ok: false,
      reason: 'the campaign is over',
    });
  });
});
