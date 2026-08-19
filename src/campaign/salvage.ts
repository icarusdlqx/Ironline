import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { SalvageRules } from '../schema/rules';
import { createRng, type Rng, type RngSeed } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import {
  addToStore,
  takeFromStore,
  type SalvageCandidate,
  type SalvageOutcome,
  type SalvageProvenance,
  type StoreKind,
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
 * How many recovered crate types the quartermaster can put before the
 * commander, and how many the dropship has room for. Hulls are towed
 * separately; weapon and equipment crates share these berths.
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

const OFFER_KINDS: readonly StoreKind[] = ['weapon', 'equipment'];

function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length < 2) return [...items];
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function offerOffset(seed: RngSeed, label: string, length: number): number {
  if (length < 2) return 0;
  // Recovery rolls own the campaign stream. A field-keyed stream can rotate
  // the loading list without moving any later casualty or salvage roll.
  const field = typeof seed === 'number' ? `number:${seed}` : `text:${seed}`;
  return createRng(`${field}:salvage-offer:${label}`).int(0, length);
}

/**
 * Builds the capped loading list without letting a large weapon pile erase
 * every recovered equipment type. Each present class gets one turn per round;
 * the battle seed rotates both the class order and the first item in each one.
 */
export function selectSalvageOffers(
  recovered: readonly StoreItem[],
  battleSeed: RngSeed,
): StoreItem[] {
  const merged = merge(recovered);
  const queues = new Map<StoreKind, StoreItem[]>();

  for (const kind of OFFER_KINDS) {
    const items = merged.filter((item) => item.kind === kind);
    queues.set(kind, rotate(items, offerOffset(battleSeed, kind, items.length)));
  }

  const present = OFFER_KINDS.filter((kind) => (queues.get(kind)?.length ?? 0) > 0);
  const order = rotate(present, offerOffset(battleSeed, 'classes', present.length));
  const offered: StoreItem[] = [];

  while (offered.length < SALVAGE_OFFERED) {
    let found = false;
    for (const kind of order) {
      const item = queues.get(kind)?.shift();
      if (item === undefined) continue;
      offered.push(item);
      found = true;
      if (offered.length >= SALVAGE_OFFERED) break;
    }
    if (!found) break;
  }

  return offered;
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

  // Every recovered hull is already aboard. Crates compete only with crates.
  const offered = selectSalvageOffers(items, result.seed);
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
