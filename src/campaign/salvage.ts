import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { SalvageRules } from '../schema/rules';
import type { Rng } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import {
  addToStore,
  takeFromStore,
  type SalvageCandidate,
  type SalvageOutcome,
  type SalvageProvenance,
  type StoreItem,
} from './types';
import type { CampaignState } from './types';

export type { SalvageCandidate, SalvageOutcome, SalvageProvenance } from './types';

export interface SalvageReport {
  candidates: SalvageCandidate[];
  chassisRecovered: string[];
  offered: StoreItem[];
  items: StoreItem[];
  provenance: SalvageProvenance[];
}

/**
 * How many of the recovered items the dropship has room for. Everything the
 * crews cut loose is offered; the commander decides what comes home, which is
 * a decision worth having and a reason to look at the debrief at all.
 *
 * Three, not two, and measured rather than guessed: a win recovers two to five
 * items, so a hold of three leaves the thin hauls whole and makes the choice
 * bite only on the rich ones. Two taxed every mission by half, which is not a
 * decision — it is a toll, and it starved the refit economy badly enough that
 * a campaign could run three contracts without ever fielding what it salvaged.
 */
export const SALVAGE_PICKS = 3;
export const SALVAGE_OFFERED = 5;

/**
 * How the mech was taken out decides what is left to tow home. An immobilised
 * mech on the losing side has surrendered — the best outcome short of an ejection.
 */
export function outcomeFor(unit: UnitResult, lostTheBattle: boolean): SalvageOutcome | null {
  if (unit.withdrew) return null;
  if (unit.alive) {
    if (lostTheBattle && unit.legged) return 'legged';
    return null;
  }
  if (unit.pilotEjected && unit.killMethod !== 'head') return 'ejected';
  if (unit.killMethod === 'head') return 'head';
  if (unit.killMethod === 'ammo_explosion') return 'ammo_explosion';
  return 'centre_torso';
}

/** Shared so contracts and field exercises cannot disagree about who lost the ground. */
export function salvageLosingTeams(
  result: BattleResult,
  playerTeam: number,
): ReadonlySet<number> {
  const enemyTeams = new Set(
    result.units.filter((unit) => unit.team !== playerTeam).map((unit) => unit.team),
  );
  return new Set([...enemyTeams].filter((team) => team !== result.winner));
}

/** Contract shares narrow these field odds later; this is the hull's condition alone. */
export function baseHullRecoveryChance(
  rules: SalvageRules,
  outcome: SalvageOutcome,
): number {
  return rules.chassisRecoveryByOutcome[outcome];
}

function itemsFrom(
  catalog: Catalog,
  rng: Rng,
  unit: UnitResult,
  designId: string,
  salvageShare: number,
): { items: StoreItem[]; provenance: SalvageProvenance[] } {
  const design = catalog.designs.get(designId);
  if (design === undefined) return { items: [], provenance: [] };

  const rules = catalog.rules.salvage;
  const recovered: StoreItem[] = [];
  const provenance: SalvageProvenance[] = [];

  const chanceFor = (location: MechLocation, base: number): number => {
    const destroyed = unit.condition[location]?.destroyed ?? false;
    return (destroyed ? rules.destroyedLocationRecovery : base) * salvageShare;
  };

  for (const mount of design.mounts) {
    const base = rng.range(rules.weaponRecoveryMin, rules.weaponRecoveryMax);
    if (rng.chance(chanceFor(mount.location, base))) {
      recovered.push({ kind: 'weapon', itemId: mount.weaponId, count: 1 });
      provenance.push({
        kind: 'weapon',
        itemId: mount.weaponId,
        sourceDesignId: designId,
        sourceMechName: unit.name,
        location: mount.location,
      });
    }
  }

  for (const fit of design.equipment) {
    if (rng.chance(chanceFor(fit.location, rules.equipmentRecovery))) {
      recovered.push({ kind: 'equipment', itemId: fit.equipmentId, count: 1 });
      provenance.push({
        kind: 'equipment',
        itemId: fit.equipmentId,
        sourceDesignId: designId,
        sourceMechName: unit.name,
        location: fit.location,
      });
    }
  }

  return { items: recovered, provenance };
}

function merge(items: readonly StoreItem[]): StoreItem[] {
  const totals = new Map<string, StoreItem>();
  for (const item of items) {
    const key = `${item.kind}:${item.itemId}`;
    const existing = totals.get(key);
    if (existing === undefined) totals.set(key, { ...item });
    else existing.count += item.count;
  }
  return [...totals.values()].sort((a, b) =>
    `${a.kind}:${a.itemId}`.localeCompare(`${b.kind}:${b.itemId}`),
  );
}

export function resolveSalvage(
  catalog: Catalog,
  rng: Rng,
  result: BattleResult,
  playerTeam: number,
  salvageShare: number,
): SalvageReport {
  const rules = catalog.rules.salvage;
  const candidates: SalvageCandidate[] = [];
  const chassisRecovered: string[] = [];
  const items: StoreItem[] = [];
  const provenance: SalvageProvenance[] = [];

  const lostTeams = salvageLosingTeams(result, playerTeam);

  for (const unit of result.units) {
    if (unit.team === playerTeam) continue;

    const outcome = outcomeFor(unit, lostTeams.has(unit.team));
    if (outcome === null) continue;

    // A hull the company cannot field is not a hull worth towing. The guns come
    // off a burnt-out carrier the same as off anything else, but the carrier is
    // scrap: there is no berth on the dropship for something that does not walk.
    const design = catalog.designs.get(unit.designId);
    const towable = catalog.chassis.get(design?.chassisId ?? '')?.frame === 'mech';

    const chassisChance = towable ? baseHullRecoveryChance(rules, outcome) * salvageShare : 0;
    const recovered = chassisChance > 0 && rng.chance(chassisChance);
    candidates.push({
      designId: unit.designId,
      name: unit.name,
      outcome,
      chassisChance,
      recovered,
    });

    if (recovered) chassisRecovered.push(unit.designId);
    const fieldItems = itemsFrom(catalog, rng, unit, unit.designId, salvageShare);
    items.push(...fieldItems.items);
    provenance.push(...fieldItems.provenance);
  }

  // Everything cut loose is offered; the hold takes what the commander picks.
  const offered = merge(items).slice(0, SALVAGE_OFFERED);
  const offeredKeys = new Set(offered.map((item) => `${item.kind}:${item.itemId}`));
  return {
    candidates,
    chassisRecovered,
    offered,
    items: offered.slice(0, SALVAGE_PICKS),
    provenance: provenance.filter((item) => offeredKeys.has(`${item.kind}:${item.itemId}`)),
  };
}

/**
 * Swaps what was taken for a different choice out of the same offer. Anything
 * not on the offer is refused outright — the debrief is a decision about what
 * the crews found, not a shopping list.
 */
export function rechooseSalvage(
  state: CampaignState,
  report: SalvageReport,
  wanted: readonly StoreItem[],
): StoreItem[] {
  const allowed = new Map(report.offered.map((item) => [`${item.kind}:${item.itemId}`, item]));
  const picked: StoreItem[] = [];
  for (const item of wanted) {
    const match = allowed.get(`${item.kind}:${item.itemId}`);
    if (match === undefined || picked.length >= SALVAGE_PICKS) continue;
    if (picked.some((held) => held.kind === match.kind && held.itemId === match.itemId)) continue;
    picked.push({ ...match });
  }

  // Put back what was taken, then take what was chosen. Doing it in that order
  // means a pick that overlaps the old one nets out to no change at all.
  for (const item of report.items) takeFromStore(state, item.kind, item.itemId, item.count);
  for (const item of picked) addToStore(state, item.kind, item.itemId, item.count);
  report.items = picked;
  return picked;
}

export function applySalvage(state: CampaignState, report: SalvageReport): void {
  for (const item of report.items) {
    addToStore(state, item.kind, item.itemId, item.count);
  }
}

export function locationsIntact(unit: UnitResult): MechLocation[] {
  return LOCATIONS.filter((location) => !(unit.condition[location]?.destroyed ?? false));
}
