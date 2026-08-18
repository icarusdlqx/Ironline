import type { PilotRecord } from '../campaign/types';
import { skillCost, skillTotal, type Skill } from '../campaign/roster';
import type { Catalog } from '../schema/load';
import type { PilotTrait } from '../schema/rules';
import { pilotStats } from './PilotStats';

function change(factor: number): string {
  const amount = Math.round(Math.abs(factor - 1) * 100);
  return `${factor >= 1 ? '+' : '-'}${amount}%`;
}

/** The exact multipliers a speciality contributes, in field language. */
export function traitEffects(trait: PilotTrait): string[] {
  const effects: string[] = [];
  if (trait.accuracyFactor !== 1) {
    effects.push(`${change(trait.accuracyFactor)} weapon accuracy`);
  }
  if (trait.incomingAccuracyFactor !== 1) {
    effects.push(`${change(trait.incomingAccuracyFactor)} enemy accuracy`);
  }
  if (trait.movingAccuracyFactor !== 1) {
    effects.push(`${change(trait.movingAccuracyFactor)} moving-fire accuracy`);
  }
  if (trait.dissipationFactor !== 1) {
    effects.push(`${change(trait.dissipationFactor)} heat dissipation`);
  }
  if (trait.sensorRangeFactor !== 1) {
    effects.push(`${change(trait.sensorRangeFactor)} sensor range`);
  }
  if (trait.criticalChanceFactor !== 1) {
    effects.push(`${change(trait.criticalChanceFactor)} critical chance`);
  }
  if (trait.survivalFactor !== 1) {
    effects.push(`${change(trait.survivalFactor)} fatality risk after mech loss`);
  }
  if (trait.xpFactor !== 1) effects.push(`${change(trait.xpFactor)} earned XP`);
  return effects;
}

export interface SkillTraining {
  skill: Skill;
  currentLevel: number;
  nextLevel: number | null;
  cost: number | null;
  currentEffect: string;
  nextEffect: string | null;
}

const STAT_LABEL: Record<Skill, string> = {
  gunnery: 'Gunnery',
  piloting: 'Piloting',
  sensors: 'Sensors',
};

function effectFor(catalog: Catalog, pilot: PilotRecord, skill: Skill): string {
  return pilotStats(catalog, pilot).find((stat) => stat.label === STAT_LABEL[skill])?.effect ?? '';
}

/** Current outcome, price and next outcome for one trainable skill. */
export function skillTraining(
  catalog: Catalog,
  pilot: PilotRecord,
  skill: Skill,
): SkillTraining {
  const currentLevel = pilot[skill];
  if (currentLevel >= 5) {
    return {
      skill,
      currentLevel,
      nextLevel: null,
      cost: null,
      currentEffect: effectFor(catalog, pilot, skill),
      nextEffect: null,
    };
  }

  const next = { ...pilot, [skill]: currentLevel + 1 };
  return {
    skill,
    currentLevel,
    nextLevel: currentLevel + 1,
    cost: skillCost(catalog, currentLevel),
    currentEffect: effectFor(catalog, pilot, skill),
    nextEffect: effectFor(catalog, next, skill),
  };
}

/** The next total-skill mark that will earn an unspent speciality pick. */
export function nextSpecialityThreshold(catalog: Catalog, pilot: PilotRecord): number | null {
  if (pilot.dead || pilot.traits.length >= catalog.rules.pilotTraits.maxTraits) return null;
  const total = skillTotal(pilot);
  return catalog.rules.pilotTraits.pickAtTotalSkill.find((mark) => mark > total) ?? null;
}
