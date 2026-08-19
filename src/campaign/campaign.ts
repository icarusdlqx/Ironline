import type { CampaignNode } from '../schema/campaign';
import type { Catalog } from '../schema/load';
import { missionTickBudget } from '../schema/missionClock';
import { pruneMarket } from './market';
import { isSideContract, pruneSideOffers, sideContracts } from './sidework';
import { createRng, rngFromState, type Rng } from '../sim/rng';
import { runBattle, type BattleResult } from '../sim/world';
import { completeRepair, pristineCondition } from './repair';
import { applyContractFailure, recoveryNotice } from './recovery';
import { availableXp, awardXp, resolveCasualty, returnedFromField } from './roster';
import { applySalvage, resolveSalvage, type SalvageReport } from './salvage';
import { negotiationOptions } from './contractTerms';
import { dailyPayroll } from './ledger';
import { employerById, recordEmployerFailure } from './employers';
import { fillEmptySeats, PLAYER_TEAM, prepareDeployment, type DeployablePair } from './deployment';
import {
  findMech, findPilot, type CampaignState, type MechRecord, type MissionOutcome, type PilotReport,
} from './types';

export { negotiationOptions } from './contractTerms';
export {
  deployableLance, DeploymentError, DROP_BERTHS, dropTeam, dropTonnageFor,
  fillEmptySeats, missionSlots, PLAYER_TEAM, prepareDeployment,
} from './deployment';
export type { DeployablePair, Deployment } from './deployment';

function log(state: CampaignState, text: string): void {
  state.log.unshift({ day: state.day, text });
  if (state.log.length > 200) state.log.length = 200;
}

function withRng<T>(state: CampaignState, use: (rng: Rng) => T): T {
  const rng = rngFromState(state.rng);
  const value = use(rng);
  state.rng = rng.save();
  return value;
}

export function startCampaign(catalog: Catalog, campaignId: string, seed: string): CampaignState {
  const campaign = catalog.campaigns.get(campaignId);
  if (campaign === undefined) throw new Error(`unknown campaign "${campaignId}"`);

  const state: CampaignState = {
    campaignId,
    seed,
    rng: createRng(`${seed}:campaign`).save(),
    day: campaign.startingDay,
    cbills: campaign.startingCbills,
    mechs: [],
    pilots: [],
    benched: [],
    store: [],
    completedNodes: [],
    failedNodes: [],
    sideTaken: [],
    marketBought: [],
    contract: null,
    history: [],
    employerFailures: [],
    log: [],
    finished: false,
    won: false,
    nextId: 1,
  };

  campaign.startingDesignIds.forEach((designId, index) => {
    const design = catalog.designs.get(designId);
    if (design === undefined) throw new Error(`unknown design "${designId}"`);

    const mech: MechRecord = {
      id: `mech-${state.nextId}`,
      design: JSON.parse(JSON.stringify(design)) as typeof design,
      condition: pristineCondition(catalog, design),
      status: 'ready',
      readyOnDay: state.day,
      rebuildCost: 0,
    };
    state.nextId += 1;
    state.mechs.push(mech);

    const pilotId = campaign.startingPilotIds[index];
    const template = pilotId === undefined ? undefined : catalog.pilots.get(pilotId);
    if (template === undefined) return;

    state.pilots.push({
      id: `pilot-${state.nextId}`,
      templateId: template.id,
      name: template.name,
      gunnery: template.gunnery,
      piloting: template.piloting,
      sensors: template.sensors,
      xp: 0,
      spentXp: 0,
      traits: [...template.traits],
      bio: template.bio,
      injuredUntilDay: state.day,
      dead: false,
      mechId: mech.id,
    });
    state.nextId += 1;
  });

  log(state, `${campaign.name} begins.`);
  return state;
}

export function campaignOf(catalog: Catalog, state: CampaignState) {
  const campaign = catalog.campaigns.get(state.campaignId);
  if (campaign === undefined) throw new Error(`unknown campaign "${state.campaignId}"`);
  return campaign;
}

/** The authored campaign only — the jobs that advance the war. */
export function campaignNodes(catalog: Catalog, state: CampaignState): CampaignNode[] {
  const campaign = campaignOf(catalog, state);
  const done = new Set(state.completedNodes);

  return campaign.nodes.filter(
    (node) =>
      !done.has(node.id) &&
      !state.failedNodes.includes(node.id) &&
      node.requires.every((required) => done.has(required)),
  );
}

/**
 * Everything signable today: the war, then whatever the hiring hall is posting.
 * Side work is what a company does when it is not ready for the next authored
 * job — before this, the calendar was the only alternative.
 */
export function availableNodes(catalog: Catalog, state: CampaignState): CampaignNode[] {
  if (state.finished) return [];
  return [...campaignNodes(catalog, state), ...sideContracts(catalog, state)];
}

export interface ActionResult {
  ok: boolean;
  reason: string | null;
}

export function acceptContract(
  catalog: Catalog,
  state: CampaignState,
  nodeId: string,
  termsId: string,
): ActionResult {
  if (state.finished) return { ok: false, reason: 'the campaign is over' };
  if (state.contract !== null) return { ok: false, reason: 'a contract is already active' };

  const node = availableNodes(catalog, state).find((entry) => entry.id === nodeId);
  if (node === undefined) return { ok: false, reason: 'that contract is not available' };

  const option = negotiationOptions(catalog, node).find((terms) => terms.id === termsId);
  if (option === undefined) return { ok: false, reason: 'invalid contract terms' };
  const employer = employerById(campaignOf(catalog, state), node.employerId);

  // A side posting is off the board the moment it is signed. The authored
  // campaign tracks completion instead, because those jobs have to stay
  // failable and their prerequisites depend on it.
  if (isSideContract(node.id)) state.sideTaken.push(node.id);

  state.contract = {
    nodeId: node.id,
    missionId: node.missionId,
    employerId: employer.id,
    employerName: employer.name,
    termsId: option.id,
    payout: option.payout,
    salvageShare: option.salvageShare,
    acceptedOnDay: state.day,
    deadlineDay: state.day + node.deadlineDays,
  };

  log(
    state,
    `Signed ${option.name.toLowerCase()} terms with ${employer.name} for ${node.name}: ` +
      `${option.payout} credits, ` +
      `${Math.round(option.salvageShare * 100)}% salvage, due day ${state.contract.deadlineDay}.`,
  );
  return { ok: true, reason: null };
}

export function abandonContract(catalog: Catalog, state: CampaignState): void {
  const contract = state.contract;
  if (contract === null) return;
  state.contract = null;
  const employerName = recordEmployerFailure(catalog, state, contract, 'withdrawn');
  const failure = applyContractFailure(catalog, state, contract);
  log(state, `Withdrew from the ${employerName} contract.${recoveryNotice(failure)}`);
  advanceDays(catalog, state, failure.recoveryDays);
}

export interface MissionRun {
  outcome: MissionOutcome;
  battle: BattleResult;
  salvage: SalvageReport;
}

export function runMission(catalog: Catalog, state: CampaignState): MissionRun {
  const deployment = prepareDeployment(catalog, state);
  const battle = runBattle(catalog, {
    seed: deployment.seed,
    missionId: deployment.missionId,
    playerTeam: deployment.playerTeam,
    playerLance: deployment.entries,
    maxTicks: missionTickBudget(catalog, deployment.missionId),
    // Auto-resolving a contract should play the lance properly, not park it.
    playerController: 'tactical',
  });
  return resolveMission(catalog, state, battle, deployment.lance);
}

export function resolveMission(
  catalog: Catalog,
  state: CampaignState,
  battle: BattleResult,
  lance: DeployablePair[],
): MissionRun {
  const contract = state.contract;
  if (contract === null) throw new Error('no active contract');

  const won = battle.missionStatus === 'success';
  const casualties: string[] = [];
  const mechsLost: string[] = [];
  const pilotReports: PilotReport[] = [];

  battle.units
    .filter((unit) => unit.team === PLAYER_TEAM)
    .forEach((unit, index) => {
      const pair = lance[index];
      if (pair === undefined) return;

      pair.mech.condition = unit.condition;
      // A mech that walked off the field is off the field, not lost — pulling a
      // cripple out before it dies is the whole point of ordering a withdrawal.
      if (returnedFromField(unit)) {
        pair.mech.status = 'ready';
      } else {
        pair.mech.status = 'hulk';
        pair.mech.rebuildCost = Math.round(
          (catalog.chassis.get(pair.mech.design.chassisId)?.baseCost ?? 0) *
            catalog.rules.salvage.hulkRebuildCostFraction,
        );
        mechsLost.push(pair.mech.design.name);
      }

      const xp = awardXp(catalog, { pilot: pair.pilot, unit }, won);

      const casualty = withRng(state, (rng) =>
        resolveCasualty(catalog, rng, pair.pilot, unit, state.day),
      );

      if (casualty.died) casualties.push(`${pair.pilot.name} (killed)`);
      else if (casualty.injuredDays > 0) {
        casualties.push(`${pair.pilot.name} (out ${casualty.injuredDays} days)`);
      }

      // Banking the award leaves the commander a real training decision; the
      // old automatic spend made the barracks buttons decorative.
      pilotReports.push({
        pilotId: pair.pilot.id,
        name: pair.pilot.name,
        mech: pair.mech.design.name,
        kills: unit.kills,
        damage: Math.round(unit.damageDealt),
        xp,
        xpBanked: availableXp(pair.pilot),
        promotions: [],
        fate: casualty.died ? 'killed' : casualty.injuredDays > 0 ? 'injured' : 'returned',
      });
    });

  const salvage = won
    ? withRng(state, (rng) =>
        resolveSalvage(catalog, rng, battle, PLAYER_TEAM, contract.salvageShare),
      )
    : { candidates: [], chassisRecovered: [], offered: [], items: [], provenance: [] };

  const failure = won ? null : applyContractFailure(catalog, state, contract);

  if (won) {
    applySalvage(state, salvage);
    state.cbills += contract.payout;

    for (const designId of salvage.chassisRecovered) {
      const design = catalog.designs.get(designId);
      if (design === undefined) continue;
      state.mechs.push({
        id: `mech-${state.nextId}`,
        design: JSON.parse(JSON.stringify(design)) as typeof design,
        condition: pristineCondition(catalog, design),
        status: 'hulk',
        readyOnDay: state.day,
        rebuildCost: Math.round(
          (catalog.chassis.get(design.chassisId)?.baseCost ?? 0) *
            catalog.rules.salvage.hulkRebuildCostFraction,
        ),
      });
      state.nextId += 1;
    }
    state.completedNodes.push(contract.nodeId);
  }

  const outcome: MissionOutcome = {
    nodeId: contract.nodeId,
    missionId: contract.missionId,
    employerId: contract.employerId,
    employerName: contract.employerName,
    termsId: contract.termsId,
    won,
    day: state.day,
    payout: won ? contract.payout : 0,
    salvagedChassis: salvage.chassisRecovered,
    salvagedItems: salvage.items,
    salvageOffered: salvage.offered,
    salvageCandidates: salvage.candidates,
    salvageProvenance: salvage.provenance,
    pilotCasualties: casualties,
    mechsLost,
    pilotReports,
  };

  state.history.push(outcome);
  state.contract = null;

  log(
    state,
    won
      ? `Contract complete: ${contract.payout} credits, ${salvage.items.length} item(s) and ` +
          `${salvage.chassisRecovered.length} chassis salvaged.`
      : `Contract failed. No payout.${recoveryNotice(failure!)}`,
  );

  const campaign = campaignOf(catalog, state);
  if (won && contract.nodeId === campaign.victoryNodeId) {
    state.finished = true;
    state.won = true;
    log(state, `${campaign.name} won.`);
  }

  advanceDays(catalog, state, 1 + (failure?.recoveryDays ?? 0));
  return { outcome, battle, salvage };
}

export function advanceDays(catalog: Catalog, state: CampaignState, days: number): void {
  let remaining = days;
  let payrollPaid = 0;

  while (remaining > 0) {
    remaining -= 1;
    state.day += 1;

    const payroll = dailyPayroll(catalog, state);
    state.cbills -= payroll;
    payrollPaid += payroll;

    for (const mech of state.mechs) {
      if (mech.status === 'repairing' && mech.readyOnDay <= state.day) {
        completeRepair(catalog, mech);
        log(state, `${mech.design.name} is out of the bay.`);
      }
    }

    if (state.contract !== null && state.day > state.contract.deadlineDay) {
      const contract = state.contract;
      state.contract = null;
      const employerName = recordEmployerFailure(catalog, state, contract, 'expired');
      const failure = applyContractFailure(catalog, state, contract);
      log(state, `The ${employerName} contract expired.${recoveryNotice(failure)}`);
      remaining += failure.recoveryDays;
    }
  }

  if (payrollPaid > 0) log(state, `Payroll: ${payrollPaid} credits.`);

  // Casualties and finished repairs both leave hulls without a pilot; seat them
  // now so the barracks and the deploy button agree before the player looks.
  fillEmptySeats(state);

  pruneSideOffers(catalog, state);
  pruneMarket(catalog, state);

  if (state.finished) return;

  // Only the war running out ends the campaign. Side work always renews, so
  // asking whether anything at all is on offer would never be false again.
  if (campaignNodes(catalog, state).length === 0 && state.contract === null) {
    state.finished = true;
    state.won = state.completedNodes.includes(campaignOf(catalog, state).victoryNodeId);
    log(state, state.won ? 'Campaign won.' : 'No contracts remain. Campaign over.');
  }
}

export { findMech, findPilot };
