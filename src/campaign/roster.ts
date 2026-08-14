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
  if (entry.unit.alive) gained += rules.missionSurvival;
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

/**
 * Which skill a pilot puts their own experience into.
 *
 * Left to themselves, people get better at what they already do: a marksman
 * works on gunnery, a scout on sensors. The player can still spend XP
 * deliberately before a debrief — this is what happens to whatever is left.
 */
const SPECIALITY: Record<string, Skill> = {
  marksman: 'gunnery',
  butcher: 'gunnery',
  snap_shot: 'piloting',
  evasive: 'piloting',
  hard_to_kill: 'piloting',
  cool_hand: 'piloting',
  spotter: 'sensors',
  quick_study: 'sensors',
};

function preferredSkills(pilot: PilotRecord): Skill[] {
  const wanted = pilot.traits.map((traitId) => SPECIALITY[traitId]).filter((skill): skill is Skill => skill !== undefined);
  // Their speciality first, then whatever is furthest behind — a pilot with no
  // speciality still rounds themselves out rather than stalling.
  const rest = [...SKILLS].sort((a, b) => pilot[a] - pilot[b]);
  return [...wanted, ...rest];
}

export interface Promotion {
  skill: Skill;
  level: number;
}

/**
 * Spends whatever experience a pilot came home with. Called at debrief, so a
 * pilot who survives a mission visibly comes back better at something.
 */
export function promote(catalog: Catalog, pilot: PilotRecord): Promotion[] {
  const gained: Promotion[] = [];
  for (let round = 0; round < SKILLS.length * MAX_SKILL; round += 1) {
    const skill = preferredSkills(pilot).find(
      (candidate) => pilot[candidate] < MAX_SKILL && availableXp(pilot) >= skillCost(catalog, pilot[candidate]),
    );
    if (skill === undefined) break;
    const result = raiseSkill(catalog, pilot, skill);
    if (!result.ok) break;
    gained.push({ skill, level: pilot[skill] });
  }
  return gained;
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
  const rules = catalog.rules.economy.pilot;

  // A pilot who walked off the field under their own power but got thrown
  // about inside the cockpit still sees the surgeon — for days, not weeks.
  // No base term: nobody had to cut them out of anything.
  if (unit.alive) {
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
 * Who is on the register and not already flying for you.
 *
 * The hiring hall is the whole roster minus the people you have. It does not
 * refresh or rotate: these are the pilots on this continent, and when the last
 * one is dead the company is down to whoever is left.
 */
export function availableHires(catalog: Catalog, state: CampaignState): Pilot[] {
  const employed = new Set(state.pilots.filter((entry) => !entry.dead).map((entry) => entry.templateId));
  const buried = new Set(state.pilots.filter((entry) => entry.dead).map((entry) => entry.templateId));
  return [...catalog.pilots.values()]
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
    text: `Signed ${template.name} for ${cost.toLocaleString()} C-bills.`,
  });
  return { ok: true, reason: null, pilot: record };
}
