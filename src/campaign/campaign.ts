import type { CampaignNode } from '../schema/campaign';
import type { Catalog } from '../schema/load';
import { missionTickBudget } from '../schema/missionClock';
import { pruneMarket } from './market';
import { isSideContract, pruneSideOffers, sideContracts } from './sidework';
import { createRng, rngFromState, type Rng } from '../sim/rng';
import { runBattle, type BattleResult, type LanceEntry } from '../sim/world';
import { completeRepair, pristineCondition } from './repair';
import { asPilot, assign, awardXp, promote, resolveCasualty } from './roster';
import { applySalvage, resolveSalvage, type SalvageReport } from './salvage';
import {
  findMech,
  findPilot,
  isMechAvailable,
  isPilotAvailable,
  type CampaignState,
  type MechRecord,
  type MissionOutcome,
  type PilotRecord,
  type PilotReport,
} from './types';

export const PLAYER_TEAM = 0;

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
  return [...campaignNodes(catalog, state), ...sideContracts(catalog, state)];
}

export interface NegotiationOption {
  step: number;
  payout: number;
  salvageShare: number;
}

export function negotiationOptions(catalog: Catalog, node: CampaignNode): NegotiationOption[] {
  const rules = catalog.rules.economy.negotiation;
  const options: NegotiationOption[] = [];

  for (let step = 0; step < rules.steps; step += 1) {
    const t = step / (rules.steps - 1);
    const factor = rules.payoutCeilingFactor + (rules.payoutFloorFactor - rules.payoutCeilingFactor) * t;
    options.push({
      step,
      payout: Math.round(node.basePayout * factor),
      salvageShare: Number((node.maxSalvageShare * t).toFixed(4)),
    });
  }

  return options;
}

export interface ActionResult {
  ok: boolean;
  reason: string | null;
}

export function acceptContract(
  catalog: Catalog,
  state: CampaignState,
  nodeId: string,
  step: number,
): ActionResult {
  if (state.contract !== null) return { ok: false, reason: 'a contract is already active' };

  const node = availableNodes(catalog, state).find((entry) => entry.id === nodeId);
  if (node === undefined) return { ok: false, reason: 'that contract is not available' };

  const option = negotiationOptions(catalog, node)[step];
  if (option === undefined) return { ok: false, reason: 'invalid negotiation step' };

  // A side posting is off the board the moment it is signed. The authored
  // campaign tracks completion instead, because those jobs have to stay
  // failable and their prerequisites depend on it.
  if (isSideContract(node.id)) state.sideTaken.push(node.id);

  state.contract = {
    nodeId: node.id,
    missionId: node.missionId,
    employer: node.employer,
    payout: option.payout,
    salvageShare: option.salvageShare,
    acceptedOnDay: state.day,
    deadlineDay: state.day + node.deadlineDays,
  };

  log(
    state,
    `Signed with ${node.employer} for ${node.name}: ${option.payout} credits, ` +
      `${Math.round(option.salvageShare * 100)}% salvage, due day ${state.contract.deadlineDay}.`,
  );
  return { ok: true, reason: null };
}

export function abandonContract(state: CampaignState): void {
  if (state.contract === null) return;
  state.failedNodes.push(state.contract.nodeId);
  log(state, `Withdrew from the ${state.contract.employer} contract.`);
  state.contract = null;
}

/** Thrown when the company cannot field anything, so the UI can say so rather than crash. */
export class DeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentError';
  }
}

export interface DeployablePair {
  mech: MechRecord;
  pilot: PilotRecord;
}

function isFieldable(state: CampaignState, mech: MechRecord): boolean {
  return mech.status !== 'hulk' && isMechAvailable(state, mech);
}

/**
 * Everyone who can walk out of the bay, paired with what they will walk out in.
 * Pilots keep their own mech; anybody left over is seated in a spare hull.
 *
 * That second pass matters: salvaged chassis arrive with nobody assigned, and a
 * killed pilot's mech is unbound, so a company could hold fit pilots and
 * battle-ready mechs and still field nothing — an unrecoverable state the game
 * never explained. This function only reads; `fillEmptySeats` writes the pairing
 * back so the barracks agrees with what deploys.
 */
export function deployableLance(state: CampaignState): DeployablePair[] {
  const pairs: DeployablePair[] = [];
  const spoken = new Set<string>();

  // A benched pilot keeps their seat on the roster: they are held back from
  // this drop, not thrown off the mech.
  const held = (id: string): boolean => state.benched.includes(id);

  for (const pilot of state.pilots) {
    if (pilot.mechId === null) continue;
    spoken.add(pilot.mechId);
    if (!isPilotAvailable(state, pilot) || held(pilot.id)) continue;
    const mech = findMech(state, pilot.mechId);
    if (mech === null || !isFieldable(state, mech)) continue;
    pairs.push({ mech, pilot });
  }

  for (const pilot of state.pilots) {
    if (pilot.mechId !== null || !isPilotAvailable(state, pilot) || held(pilot.id)) continue;
    const free = state.mechs.find(
      (mech) => !spoken.has(mech.id) && isFieldable(state, mech),
    );
    if (free === undefined) break;
    spoken.add(free.id);
    pairs.push({ mech: free, pilot });
  }

  return pairs;
}

/** Records the pairing `deployableLance` worked out, so the roster matches the field. */
export function fillEmptySeats(state: CampaignState): void {
  for (const pair of deployableLance(state)) {
    if (pair.pilot.mechId !== pair.mech.id) assign(state, pair.pilot.id, pair.mech.id);
  }
}

/**
 * The most machines any drop will carry, however light they are. The real
 * constraint on a drop is the tonnage allowance — three heavies instead of
 * four mediums is a legitimate answer to it — so berths are a wide sanity cap
 * rather than the authored lance size they used to be.
 */
export const DROP_BERTHS = 6;

export function missionSlots(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  const authored =
    mission?.lances.find((lance) => lance.team === PLAYER_TEAM)?.units.length ?? 0;
  return authored === 0 ? 0 : Math.max(authored, DROP_BERTHS);
}

/** Tonnage of a design's chassis, or zero if the design has gone missing. */
function tonnageOf(catalog: Catalog, design: { chassisId: string }): number {
  return catalog.chassis.get(design.chassisId)?.tonnage ?? 0;
}

/**
 * What the dropship will carry to this contract. Authored per mission; when a
 * mission does not say, the allowance is the lance it fields itself, so old
 * content keeps working and nobody is quietly locked out of their own mission.
 */
export function dropTonnageFor(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  if (mission === undefined) return 0;
  if (mission.dropTonnage !== null) return mission.dropTonnage;

  const lance = mission.lances.find((entry) => entry.team === PLAYER_TEAM);
  return (lance?.units ?? []).reduce((total, unit) => {
    const design = catalog.designs.get(unit.designId);
    return total + (design === undefined ? 0 : tonnageOf(catalog, design));
  }, 0);
}

/**
 * The lance as it will actually drop: berths first, then weight. Cutting by
 * weight has to happen here rather than only in the UI, because a contract
 * resolved from the campaign screen never opens the manifest at all.
 */
export function dropTeam(
  catalog: Catalog,
  state: CampaignState,
  missionId: string,
): DeployablePair[] {
  const berths = missionSlots(catalog, missionId);
  const allowance = dropTonnageFor(catalog, missionId);

  const taken: DeployablePair[] = [];
  let tons = 0;
  for (const pair of deployableLance(state)) {
    if (taken.length >= berths) break;
    const weight = tonnageOf(catalog, pair.mech.design);
    if (tons + weight > allowance) continue;
    taken.push(pair);
    tons += weight;
  }
  return taken;
}

export interface MissionRun {
  outcome: MissionOutcome;
  battle: BattleResult;
  salvage: SalvageReport;
}

export interface Deployment {
  seed: string;
  missionId: string;
  playerTeam: number;
  lance: DeployablePair[];
  entries: LanceEntry[];
}

/** Builds the battle inputs for the active contract, shared by the harness and the UI. */
export function prepareDeployment(catalog: Catalog, state: CampaignState): Deployment {
  const contract = state.contract;
  if (contract === null) throw new Error('no active contract');

  fillEmptySeats(state);
  const lance = dropTeam(catalog, state, contract.missionId);
  if (lance.length === 0) {
    const anyReady = deployableLance(state).length > 0;
    throw new DeploymentError(
      anyReady
        ? `Nothing the company can field fits the ${dropTonnageFor(catalog, contract.missionId)}t drop allowance for this contract.`
        : 'No mech is ready to deploy. Repair a mech, rebuild a hulk, or wait for a pilot to recover.',
    );
  }

  return {
    seed: `${state.seed}:${contract.nodeId}:${state.day}`,
    missionId: contract.missionId,
    playerTeam: PLAYER_TEAM,
    lance,
    entries: lance.map(({ mech, pilot }) => ({
      design: mech.design,
      pilot: asPilot(pilot),
      damage: mech.condition,
    })),
  };
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
      if (unit.alive || unit.withdrew) {
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

      // A pilot who came home spends what they learned on the way. After the
      // casualty roll on purpose: the dead do not get better at anything.
      const promotions: string[] = [];
      if (!casualty.died) {
        for (const step of promote(catalog, pair.pilot)) {
          promotions.push(`${step.skill} ${step.level}`);
          log(state, `${pair.pilot.name} reached ${step.skill} ${step.level}.`);
        }
      }

      if (casualty.died) casualties.push(`${pair.pilot.name} (killed)`);
      else if (casualty.injuredDays > 0) {
        casualties.push(`${pair.pilot.name} (out ${casualty.injuredDays} days)`);
      }

      pilotReports.push({
        pilotId: pair.pilot.id,
        name: pair.pilot.name,
        mech: pair.mech.design.name,
        kills: unit.kills,
        damage: Math.round(unit.damageDealt),
        xp,
        promotions,
        fate: casualty.died ? 'killed' : casualty.injuredDays > 0 ? 'injured' : 'returned',
      });
    });

  const salvage = won
    ? withRng(state, (rng) =>
        resolveSalvage(catalog, rng, battle, PLAYER_TEAM, contract.salvageShare),
      )
    : { candidates: [], chassisRecovered: [], offered: [], items: [] };

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
  } else {
    state.failedNodes.push(contract.nodeId);
  }

  const outcome: MissionOutcome = {
    nodeId: contract.nodeId,
    missionId: contract.missionId,
    won,
    day: state.day,
    payout: won ? contract.payout : 0,
    salvagedChassis: salvage.chassisRecovered,
    salvagedItems: salvage.items,
    salvageOffered: salvage.offered,
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
      : 'Contract failed. No payout.',
  );

  const campaign = campaignOf(catalog, state);
  if (won && contract.nodeId === campaign.victoryNodeId) {
    state.finished = true;
    state.won = true;
    log(state, `${campaign.name} won.`);
  }

  advanceDays(catalog, state, 1);
  return { outcome, battle, salvage };
}

export function advanceDays(catalog: Catalog, state: CampaignState, days: number): void {
  const salary = catalog.rules.economy.pilot.salaryPerDay;

  for (let step = 0; step < days; step += 1) {
    state.day += 1;

    const living = state.pilots.filter((pilot) => !pilot.dead).length;
    state.cbills -= salary * living;

    for (const mech of state.mechs) {
      if (mech.status === 'repairing' && mech.readyOnDay <= state.day) {
        completeRepair(catalog, mech);
        log(state, `${mech.design.name} is out of the bay.`);
      }
    }

    if (state.contract !== null && state.day > state.contract.deadlineDay) {
      log(state, `The ${state.contract.employer} contract expired.`);
      state.failedNodes.push(state.contract.nodeId);
      state.contract = null;
    }
  }

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
