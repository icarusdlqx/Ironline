import type { CampaignNode } from '../schema/campaign';
import type { Catalog } from '../schema/load';
import { createRng } from '../sim/rng';
import type { CampaignState } from './types';

const PLAYER_TEAM = 0;

/** Which week of postings the hiring hall is showing. */
export function offerPeriod(catalog: Catalog, day: number): number {
  return Math.floor(day / catalog.rules.economy.sideContracts.refreshDays);
}

/**
 * Everything on the other side of a mission, by weight. This is the difficulty
 * index a side contract is priced off: it needs no new authored numbers and it
 * rises with the garrison, so the hard jobs pay like hard jobs.
 */
export function oppositionTonnage(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  if (mission === undefined) return 0;

  let total = 0;
  for (const lance of mission.lances) {
    if (lance.team === PLAYER_TEAM) continue;
    for (const unit of lance.units) {
      const design = catalog.designs.get(unit.designId);
      const chassis = design === undefined ? undefined : catalog.chassis.get(design.chassisId);
      total += chassis?.tonnage ?? 0;
    }
  }
  return total;
}

/**
 * What the hall is posting this week.
 *
 * Derived, never stored. Seeding off the campaign seed and the period number
 * rebuilds an identical board on every render, every reload and every replay of
 * the same save — which matters because the campaign screen recomputes this on
 * each React render, and drawing from `state.rng` would make the campaign's
 * whole random stream depend on how many times the player looked at it.
 *
 * The board must depend on the period and nothing else that moves inside one,
 * or the offers flicker from day to day.
 */
export function sideContracts(catalog: Catalog, state: CampaignState): CampaignNode[] {
  const campaign = catalog.campaigns.get(state.campaignId);
  const pool = campaign?.sideWork.missionIds ?? [];
  const employers = campaign?.sideWork.employers ?? [];
  if (pool.length === 0 || employers.length === 0) return [];

  const rules = catalog.rules.economy.sideContracts;
  const period = offerPeriod(catalog, state.day);
  const rng = createRng(`${state.seed}:sidework:${period}`);

  // Shuffled rather than picked, so one week never posts the same job twice —
  // and the same for who is posting, so the board reads as a hall with several
  // outfits in it rather than one client with a lot of work.
  const offered = rng.shuffle(pool).slice(0, rules.offersPerPeriod);
  const posting = rng.shuffle(employers);
  const taken = new Set(state.sideTaken);
  const nodes: CampaignNode[] = [];

  offered.forEach((missionId, slot) => {
    const id = `side_${period}_${slot}`;
    const mission = catalog.missions.get(missionId);

    // Draws happen for every slot whether or not it survives the filters, so
    // taking one offer cannot shift the terms of the ones beside it.
    const variance = rng.range(rules.payoutVariance[0], rules.payoutVariance[1]);
    const share = rng.range(rules.salvageShare[0], rules.salvageShare[1]);
    const deadline = rng.int(rules.deadlineDays[0], rules.deadlineDays[1] + 1);
    const employer = posting[slot % posting.length] ?? employers[0] ?? 'Unknown';

    if (mission === undefined || taken.has(id)) return;

    const opposition = oppositionTonnage(catalog, missionId);
    const allowance = dropAllowance(catalog, missionId);

    // A job that outweighs what the dropship can carry to it pays for the
    // trouble. This is the only thing that makes a bad-odds posting worth
    // reading twice.
    const overmatch =
      allowance <= 0 ? 0 : Math.max(0, opposition / allowance - 1) * rules.overmatchBonusFactor;

    const raw = opposition * rules.payoutPerOpposingTon * (1 + overmatch) * variance;

    nodes.push({
      id,
      name: mission.name,
      missionId,
      employer,
      brief: mission.briefing,
      requires: [],
      basePayout: Math.max(
        rules.payoutRounding,
        Math.round(raw / rules.payoutRounding) * rules.payoutRounding,
      ),
      maxSalvageShare: Number(share.toFixed(4)),
      deadlineDays: deadline,
      // Side work is never drawn on the campaign map; it is posted on a board.
      position: { x: 0, y: 0 },
    });
  });

  return nodes;
}

/** Mirrors the campaign's own drop allowance without importing it back. */
function dropAllowance(catalog: Catalog, missionId: string): number {
  const mission = catalog.missions.get(missionId);
  if (mission === undefined) return 0;
  if (mission.dropTonnage !== null) return mission.dropTonnage;

  const lance = mission.lances.find((entry) => entry.team === PLAYER_TEAM);
  return (lance?.units ?? []).reduce((total, unit) => {
    const design = catalog.designs.get(unit.designId);
    const chassis = design === undefined ? undefined : catalog.chassis.get(design.chassisId);
    return total + (chassis?.tonnage ?? 0);
  }, 0);
}

/** True for an id this module minted, as opposed to an authored campaign node. */
export function isSideContract(nodeId: string): boolean {
  return nodeId.startsWith('side_');
}

/**
 * Forgets offers from weeks that have rolled over. Consumption is the only
 * thing about the board that is persisted, and this is what keeps that list
 * bounded rather than growing for the length of the campaign.
 */
export function pruneSideOffers(catalog: Catalog, state: CampaignState): void {
  const live = `side_${offerPeriod(catalog, state.day)}_`;
  state.sideTaken = state.sideTaken.filter((id) => id.startsWith(live));
}
