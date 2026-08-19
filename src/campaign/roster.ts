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
    bio: record.bio,
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

export function returnedFromField(unit: UnitResult): boolean {
  return unit.alive || unit.withdrew;
}

/**
 * What a pilot learned from a drop.
 *
 * Everything they actually did counts: rounds put on target, machines killed,
 * damage traded, and walking off the field at the end of it. A pilot who spent
 * a mission behind a ridge learns almost nothing, which is the point — the
 * roster improves by being used, not by the calendar turning over.
 */
export function awardXp(catalog: Catalog, entry: PilotMissionRecord, won: boolean): number {
  const rules = catalog.rules.economy.xp;
  let gained =
    entry.unit.damageDealt * rules.perDamageDealt +
    entry.unit.shotsHit * rules.perHit +
    entry.unit.kills * rules.perKill;
  if (returnedFromField(entry.unit)) gained += rules.missionSurvival;
  if (won) gained += rules.missionWin;

  gained *= traitFactor(catalog, entry.pilot, 'xpFactor');

  const rounded = Math.round(gained);
  entry.pilot.xp += rounded;
  return rounded;
}

/** The product of a pilot's specialities on one factor. */
export function traitFactor(
  catalog: Catalog,
  pilot: PilotRecord,
  key: 'survivalFactor' | 'xpFactor',
): number {
  let factor = 1;
  for (const traitId of pilot.traits) {
    const trait = catalog.rules.pilotTraits.entries[traitId];
    if (trait !== undefined) factor *= trait[key];
  }
  return factor;
}

export interface CasualtyResult {
  died: boolean;
  injuredDays: number;
}

function preserveWithdrawalSequence(catalog: Catalog, rng: Rng, pilot: PilotRecord): void {
  const rules = catalog.rules.economy.pilot;
  const survival = traitFactor(catalog, pilot, 'survivalFactor');
  // Withdrawal once entered the mech-loss branch. Keeping its discarded draws
  // prevents a corrected pilot outcome from rerolling salvage on existing seeds.
  if (rng.chance(rules.deathChanceOnMechLoss * survival)) return;
  if (rng.chance(rules.injuryChanceOnMechLoss * survival)) rng.int(1, 4);
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
  const rules = catalog.rules.economy.pilot;

  // A pilot who walked off the field under their own power but got thrown
  // about inside the cockpit still sees the surgeon — for days, not weeks.
  // No base term: nobody had to cut them out of anything.
  if (returnedFromField(unit)) {
    if (!unit.alive) preserveWithdrawalSequence(catalog, rng, pilot);
    if (unit.pilotWounds <= 0) return { died: false, injuredDays: 0 };
    const days = rules.injuryDaysPerWound * unit.pilotWounds;
    pilot.injuredUntilDay = day + days;
    return { died: false, injuredDays: days };
  }

  if (unit.pilotDead) {
    pilot.dead = true;
    pilot.mechId = null;
    return { died: true, injuredDays: 0 };
  }

  const survival = traitFactor(catalog, pilot, 'survivalFactor');
  if (rng.chance(rules.deathChanceOnMechLoss * survival)) {
    pilot.dead = true;
    pilot.mechId = null;
    return { died: true, injuredDays: 0 };
  }

  if (!rng.chance(rules.injuryChanceOnMechLoss * survival)) return { died: false, injuredDays: 0 };

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

export interface HireResult {
  ok: boolean;
  reason: string | null;
  pilot: PilotRecord | null;
}

/**
 * Who this campaign put on the register and is not already flying for you.
 *
 * The authored pool is a content boundary, not a save boundary. A pilot hired
 * by an older build stays employed even if the register has since tightened.
 */
export function availableHires(catalog: Catalog, state: CampaignState): Pilot[] {
  const employed = new Set(state.pilots.filter((entry) => !entry.dead).map((entry) => entry.templateId));
  const buried = new Set(state.pilots.filter((entry) => entry.dead).map((entry) => entry.templateId));
  const campaign = catalog.campaigns.get(state.campaignId);
  return (campaign?.hiringPoolPilotIds ?? [])
    .map((id) => catalog.pilots.get(id))
    .filter((pilot): pilot is Pilot => pilot !== undefined)
    .filter((pilot) => !employed.has(pilot.id) && !buried.has(pilot.id))
    .sort((a, b) => hireCost(catalog, a) - hireCost(catalog, b));
}

/** Signs a pilot, if the books will stand it. */
export function hirePilot(
  catalog: Catalog,
  state: CampaignState,
  templateId: string,
): HireResult {
  const template = catalog.pilots.get(templateId);
  if (template === undefined) return { ok: false, reason: 'no such pilot', pilot: null };
  const campaign = catalog.campaigns.get(state.campaignId);
  if (campaign?.hiringPoolPilotIds.includes(templateId) !== true) {
    return { ok: false, reason: `${template.name} is not on this campaign's register`, pilot: null };
  }
  if (state.pilots.some((entry) => entry.templateId === templateId)) {
    return { ok: false, reason: `${template.name} is already on the books`, pilot: null };
  }

  const cost = hireCost(catalog, template);
  if (state.cbills < cost) {
    return { ok: false, reason: `${template.name} wants ${cost.toLocaleString()} C`, pilot: null };
  }

  state.cbills -= cost;
  state.nextId += 1;
  const record: PilotRecord = {
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
    mechId: null,
  };
  state.pilots.push(record);
  state.log.unshift({
    day: state.day,
    text: `Signed ${template.name} for ${cost.toLocaleString()} credits.`,
  });
  return { ok: true, reason: null, pilot: record };
}

/** Total skill across the three tracks — what a pilot's promotions add up to. */
export function skillTotal(pilot: PilotRecord): number {
  return pilot.gunnery + pilot.piloting + pilot.sensors;
}

/**
 * How many specialities this pilot has earned but not yet been given.
 *
 * Derived from what they have rather than counted into a field: a pick is owed
 * for each threshold their skills have passed, less the specialities they are
 * already carrying that a company could have trained. Deriving it means a save
 * from before picks existed grants the right number rather than none, and no
 * counter can drift out of step with the skills that justify it.
 */
export function pendingTraitPicks(catalog: Catalog, pilot: PilotRecord): number {
  const rules = catalog.rules.pilotTraits;
  if (pilot.dead) return 0;

  const earned = rules.pickAtTotalSkill.filter((mark) => skillTotal(pilot) >= mark).length;
  const trained = pilot.traits.filter((id) => rules.entries[id]?.trainable === true).length;

  const room = rules.maxTraits - pilot.traits.length;
  return Math.max(0, Math.min(earned - trained, room));
}

/** Specialities this pilot could be given: trainable, and not already held. */
export function offeredTraits(catalog: Catalog, pilot: PilotRecord): string[] {
  return Object.entries(catalog.rules.pilotTraits.entries)
    .filter(([id, trait]) => trait.trainable && !pilot.traits.includes(id))
    .map(([id]) => id)
    .sort();
}

/**
 * Awards a speciality the pilot has earned. Refuses anything they have not,
 * so the campaign screen cannot hand out a trait by asking twice.
 */
export function chooseTrait(
  catalog: Catalog,
  pilot: PilotRecord,
  traitId: string,
): { ok: boolean; reason: string | null } {
  if (pendingTraitPicks(catalog, pilot) <= 0) {
    return { ok: false, reason: `${pilot.name} has not earned a speciality` };
  }
  if (!offeredTraits(catalog, pilot).includes(traitId)) {
    return { ok: false, reason: 'that speciality is not on offer' };
  }

  pilot.traits.push(traitId);
  return { ok: true, reason: null };
}
