import type { Catalog } from '../schema/load';
import type { Pilot } from '../schema/pilot';
import type { Rng } from '../sim/rng';
import type { UnitResult } from '../sim/world';
import type { CampaignState, PilotRecord } from './types';

export type Skill = 'gunnery' | 'piloting' | 'sensors';
export const SKILLS: readonly Skill[] = ['gunnery', 'piloting', 'sensors'];

const MAX_SKILL = 5;

export function asPilot(record: PilotRecord): Pilot {
  return {
    id: record.templateId,
    name: record.name,
    gunnery: record.gunnery,
    piloting: record.piloting,
    sensors: record.sensors,
    traits: record.traits,
  };
}

export function availableXp(pilot: PilotRecord): number {
  return pilot.xp - pilot.spentXp;
}

export function skillCost(catalog: Catalog, currentLevel: number): number {
  const rules = catalog.rules.economy.xp;
  return Math.round(rules.skillCostBase * rules.skillCostGrowth ** (currentLevel - 1));
}

export interface SkillUpResult {
  ok: boolean;
  reason: string | null;
  cost: number;
}

export function raiseSkill(
  catalog: Catalog,
  pilot: PilotRecord,
  skill: Skill,
): SkillUpResult {
  const current = pilot[skill];
  const cost = skillCost(catalog, current);

  if (current >= MAX_SKILL) return { ok: false, reason: 'already at maximum', cost };
  if (availableXp(pilot) < cost) return { ok: false, reason: 'not enough XP', cost };

  pilot[skill] = current + 1;
  pilot.spentXp += cost;
  return { ok: true, reason: null, cost };
}

export function hireCost(catalog: Catalog, pilot: Pilot): number {
  const rules = catalog.rules.economy.pilot;
  const skillPoints = pilot.gunnery + pilot.piloting + pilot.sensors;
  return Math.round(rules.hireCostBase + rules.hireCostPerSkillPoint * skillPoints);
}

export interface PilotMissionRecord {
  pilot: PilotRecord;
  unit: UnitResult;
}

export function awardXp(catalog: Catalog, entry: PilotMissionRecord, won: boolean): number {
  const rules = catalog.rules.economy.xp;
  let gained = entry.unit.damageDealt * rules.perDamageDealt + entry.unit.kills * rules.perKill;
  if (entry.unit.alive) gained += rules.missionSurvival;
  if (won) gained += rules.missionWin;

  const rounded = Math.round(gained);
  entry.pilot.xp += rounded;
  return rounded;
}

export interface CasualtyResult {
  died: boolean;
  injuredDays: number;
}

/**
 * A pilot only risks harm when their mech goes down. A head kill is far more
 * likely to be fatal than losing the mech around them.
 */
export function resolveCasualty(
  catalog: Catalog,
  rng: Rng,
  pilot: PilotRecord,
  unit: UnitResult,
  day: number,
): CasualtyResult {
  if (unit.alive) return { died: false, injuredDays: 0 };

  const rules = catalog.rules.economy.pilot;

  if (unit.pilotDead) {
    pilot.dead = true;
    pilot.mechId = null;
    return { died: true, injuredDays: 0 };
  }

  if (rng.chance(rules.deathChanceOnMechLoss)) {
    pilot.dead = true;
    pilot.mechId = null;
    return { died: true, injuredDays: 0 };
  }

  if (!rng.chance(rules.injuryChanceOnMechLoss)) return { died: false, injuredDays: 0 };

  const wounds = rng.int(1, 4);
  const days = rules.injuryDaysBase + rules.injuryDaysPerWound * wounds;
  pilot.injuredUntilDay = day + days;
  return { died: false, injuredDays: days };
}

export function assign(state: CampaignState, pilotId: string, mechId: string | null): void {
  const pilot = state.pilots.find((entry) => entry.id === pilotId);
  if (pilot === undefined) return;

  if (mechId !== null) {
    for (const other of state.pilots) {
      if (other.id !== pilotId && other.mechId === mechId) other.mechId = null;
    }
  }
  pilot.mechId = mechId;
}
