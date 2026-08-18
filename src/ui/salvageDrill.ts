import {
  baseHullRecoveryChance,
  outcomeFor,
  salvageLosingTeams,
} from '../campaign/salvage';
import type { SalvageOutcome } from '../campaign/types';
import type { SalvageRules } from '../schema/rules';
import type { BattleResult } from '../sim/world';
import type { UnitSnapshot } from './store';

export const SALVAGE_DRILL_MISSION_ID = 'salvage_tactics';

type ObservedTarget = Pick<
  UnitSnapshot,
  'name' | 'identified' | 'alive' | 'lostLocations'
>;

export type DrillLegState = 'intact' | 'lost' | 'unknown';

export interface SalvageDrillProgress {
  targetName: string;
  visible: boolean;
  leftLeg: DrillLegState;
  rightLeg: DrillLegState;
  legsLost: number | null;
  operational: boolean | null;
  status: string;
  instruction: string;
}

export function salvageDrillProgress(
  visibleEnemies: readonly ObservedTarget[],
): SalvageDrillProgress {
  const target = visibleEnemies[0];
  if (target === undefined) {
    return {
      targetName: 'Target off sensors',
      visible: false,
      leftLeg: 'unknown',
      rightLeg: 'unknown',
      legsLost: null,
      operational: null,
      status: 'Condition withheld',
      instruction: 'Hold the recovery yard. The debrief records the field result; absent contacts stay off the board.',
    };
  }

  const leftLeg = target.lostLocations.includes('left_leg') ? 'lost' : 'intact';
  const rightLeg = target.lostLocations.includes('right_leg') ? 'lost' : 'intact';
  const legsLost = Number(leftLeg === 'lost') + Number(rightLeg === 'lost');
  const targetName = target.identified ? target.name : 'Range target';

  if (!target.alive) {
    return {
      targetName,
      visible: true,
      leftLeg,
      rightLeg,
      legsLost,
      operational: false,
      status: 'Out of action',
      instruction: 'Hold the recovery yard. The debrief will grade the field result that occurred.',
    };
  }

  if (legsLost === 2) {
    return {
      targetName,
      visible: true,
      leftLeg,
      rightLeg,
      legsLost,
      operational: true,
      status: 'Immobilised · still operational',
      instruction: 'Both legs are gone. Press Hold Fire now, then hold the yard until the clock expires.',
    };
  }

  if (legsLost === 1) {
    const next = leftLeg === 'intact' ? 'LL' : 'RL';
    return {
      targetName,
      visible: true,
      leftLeg,
      rightLeg,
      legsLost,
      operational: true,
      status: 'Operational · one leg lost',
      instruction: `Set Called Shot to ${next}, then tap the target. One leg remains.`,
    };
  }

  return {
    targetName,
    visible: true,
    leftLeg,
    rightLeg,
    legsLost,
    operational: true,
    status: 'Operational · legs intact',
    instruction: 'Select Called Shot, choose LL in the location grid, then tap the target.',
  };
}

const OUTCOME_LABELS: Record<SalvageOutcome, string> = {
  legged: 'Legged',
  head: 'Head destroyed',
  centre_torso: 'Centre torso destroyed',
  ammo_explosion: 'Ammo explosion',
  ejected: 'Hull abandoned',
};

export interface SalvageDrillReport {
  targetName: string;
  legsLost: number;
  outcome: SalvageOutcome | null;
  outcomeLabel: string;
  baseHullChance: number | null;
  standardMet: boolean;
}

export function salvageDrillReport(
  result: BattleResult,
  playerTeam: number,
  rules: SalvageRules,
): SalvageDrillReport {
  const target = result.units.find((unit) => unit.team !== playerTeam);
  if (target === undefined) {
    return {
      targetName: 'No range target',
      legsLost: 0,
      outcome: null,
      outcomeLabel: 'No candidate',
      baseHullChance: null,
      standardMet: false,
    };
  }

  const lostTeams = salvageLosingTeams(result, playerTeam);
  const outcome = outcomeFor(target, lostTeams.has(target.team));
  const legsLost = Number(target.condition.left_leg.destroyed) +
    Number(target.condition.right_leg.destroyed);

  return {
    targetName: target.name,
    legsLost,
    outcome,
    outcomeLabel: outcome === null ? 'No salvage candidate' : OUTCOME_LABELS[outcome],
    baseHullChance: outcome === null ? null : baseHullRecoveryChance(rules, outcome),
    standardMet: outcome === 'legged',
  };
}

export function percentChance(value: number | null): string {
  if (value === null) return '—';
  return `${Number((value * 100).toFixed(1))}%`;
}
