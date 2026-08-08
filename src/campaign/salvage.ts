import { LOCATIONS, type MechLocation } from '../schema/common';
import type { Catalog } from '../schema/load';
import type { Rng } from '../sim/rng';
import type { BattleResult, UnitResult } from '../sim/world';
import { addToStore, type StoreItem } from './types';
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
  items: StoreItem[];
}

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

    const chassisChance = rules.chassisRecoveryByOutcome[outcome] * salvageShare;
    candidates.push({
      designId: unit.designId,
      name: unit.name,
      outcome,
      chassisChance,
    });

    if (rng.chance(chassisChance)) chassisRecovered.push(unit.designId);
    items.push(...itemsFrom(catalog, rng, unit, unit.designId, salvageShare));
  }

  return { candidates, chassisRecovered, items: merge(items) };
}

export function applySalvage(state: CampaignState, report: SalvageReport): void {
  for (const item of report.items) {
    addToStore(state, item.kind, item.itemId, item.count);
  }
}

export function locationsIntact(unit: UnitResult): MechLocation[] {
  return LOCATIONS.filter((location) => !(unit.condition[location]?.destroyed ?? false));
}
