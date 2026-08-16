import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { Rng } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import { addToStore, takeFromStore, type StoreItem } from './types';
import type { CampaignState } from './types';

export type SalvageOutcome = 'centre_torso' | 'head' | 'ammo_explosion' | 'legged' | 'ejected';

export interface SalvageCandidate {
  designId: string;
  name: string;
  outcome: SalvageOutcome;
  chassisChance: number;
}

export interface SalvageReport {
  candidates: SalvageCandidate[];
  chassisRecovered: string[];
  /** What the crews actually got off the field: the shortlist to choose from. */
  offered: StoreItem[];
  /** What was taken. A subset of `offered`, sized by the salvage rules. */
  items: StoreItem[];
}

/**
 * How many of the recovered items the dropship has room for. Everything the
 * crews cut loose is offered; the commander decides what comes home, which is
 * a decision worth having and a reason to look at the debrief at all.
 */
export const SALVAGE_PICKS = 2;
export const SALVAGE_OFFERED = 5;

/**
 * How the mech was taken out decides what is left to tow home. An immobilised
 * mech on the losing side has surrendered — the best outcome short of an ejection.
 */
export function outcomeFor(unit: UnitResult, lostTheBattle: boolean): SalvageOutcome | null {
  if (unit.alive) {
    if (lostTheBattle && unit.legged) return 'legged';
    return null;
  }
  if (unit.pilotEjected && unit.killMethod !== 'head') return 'ejected';
  if (unit.killMethod === 'head') return 'head';
  if (unit.killMethod === 'ammo_explosion') return 'ammo_explosion';
  return 'centre_torso';
}

function itemsFrom(
  catalog: Catalog,
  rng: Rng,
  unit: UnitResult,
  designId: string,
  salvageShare: number,
): StoreItem[] {
  const design = catalog.designs.get(designId);
  if (design === undefined) return [];

  const rules = catalog.rules.salvage;
  const recovered: StoreItem[] = [];

  const chanceFor = (location: MechLocation, base: number): number => {
    const destroyed = unit.condition[location]?.destroyed ?? false;
    return (destroyed ? rules.destroyedLocationRecovery : base) * salvageShare;
  };

  for (const mount of design.mounts) {
    const base = rng.range(rules.weaponRecoveryMin, rules.weaponRecoveryMax);
    if (rng.chance(chanceFor(mount.location, base))) {
      recovered.push({ kind: 'weapon', itemId: mount.weaponId, count: 1 });
    }
  }

  for (const fit of design.equipment) {
    if (rng.chance(chanceFor(fit.location, rules.equipmentRecovery))) {
      recovered.push({ kind: 'equipment', itemId: fit.equipmentId, count: 1 });
    }
  }

  return recovered;
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

  const enemyTeams = new Set(
    result.units.filter((unit) => unit.team !== playerTeam).map((unit) => unit.team),
  );
  const lostTeams = new Set(
    [...enemyTeams].filter((team) => team !== result.winner),
  );

  for (const unit of result.units) {
    if (unit.team === playerTeam) continue;

    const outcome = outcomeFor(unit, lostTeams.has(unit.team));
    if (outcome === null) continue;

    // A hull the company cannot field is not a hull worth towing. The guns come
    // off a burnt-out carrier the same as off anything else, but the carrier is
    // scrap: there is no berth on the dropship for something that does not walk.
    const design = catalog.designs.get(unit.designId);
    const towable = catalog.chassis.get(design?.chassisId ?? '')?.frame === 'mech';

    const chassisChance = towable ? rules.chassisRecoveryByOutcome[outcome] * salvageShare : 0;
    candidates.push({
      designId: unit.designId,
      name: unit.name,
      outcome,
      chassisChance,
    });

    if (chassisChance > 0 && rng.chance(chassisChance)) chassisRecovered.push(unit.designId);
    items.push(...itemsFrom(catalog, rng, unit, unit.designId, salvageShare));
  }

  // Everything cut loose is offered; the hold takes what the commander picks.
  const offered = merge(items).slice(0, SALVAGE_OFFERED);
  return {
    candidates,
    chassisRecovered,
    offered,
    items: offered.slice(0, SALVAGE_PICKS),
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
