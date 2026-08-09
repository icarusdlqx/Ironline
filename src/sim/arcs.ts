import type { MechLocation } from '../schema/common';
import type { AttackArc, CombatRules } from '../schema/rules';
import { ATTACK_ARCS } from '../schema/rules';
import { angleDifference, bearing } from './math';
import type { MechEntity, Vec2 } from './types';

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Which flank the fire is coming in on. */
export type NearSide = 'left' | 'right';

export interface ArcHit {
  arc: AttackArc;
  near: NearSide;
}

export type ArcTableKey = `${AttackArc}:${NearSide}`;
export type ArcTables = Record<ArcTableKey, readonly { value: MechLocation; weight: number }[]>;

/**
 * Where a shot is coming from, relative to the way the target's hull is pointed.
 * The torso can be wound round to shoot behind, but the plating does not move
 * with it — this reads the hull, deliberately.
 *
 * Positive angular offsets are taken as the target's right. Which flank is
 * which only decides whether damage lands on the left or right column of the
 * paper doll; the arc itself is what carries the weight.
 */
export function attackArcFrom(rules: CombatRules, target: MechEntity, from: Vec2): ArcHit {
  const offset = angleDifference(target.facing, bearing(target.pos, from));
  const away = Math.abs(offset);
  const near: NearSide = offset < 0 ? 'left' : 'right';

  const front = (rules.attackArcs.frontDegrees / 2) * DEGREES_TO_RADIANS;
  if (away <= front) return { arc: 'front', near };

  const rear = Math.PI - (rules.attackArcs.rearDegrees / 2) * DEGREES_TO_RADIANS;
  if (away >= rear) return { arc: 'rear', near };

  return { arc: 'side', near };
}

/** The location a shot on this arc lands on, given a roll in [0, 1). */
export function arcTableKey(hit: ArcHit): ArcTableKey {
  return `${hit.arc}:${hit.near}`;
}

/**
 * Turns the near/far tables in the rules into concrete left/right ones, once,
 * at world creation. Six small tables cost nothing to hold and save resolving
 * the sided names on every shot of every battle.
 */
export function buildArcTables(rules: CombatRules): ArcTables {
  const tables = {} as ArcTables;

  for (const arc of ATTACK_ARCS) {
    for (const near of ['left', 'right'] as const) {
      const far = near === 'left' ? 'right' : 'left';
      const weights = rules.attackArcs[arc].hitLocationWeights;

      const entries: { value: MechLocation; weight: number }[] = [
        { value: 'head', weight: weights.head },
        { value: 'centre_torso', weight: weights.centre_torso },
        { value: `${near}_torso`, weight: weights.near_torso },
        { value: `${far}_torso`, weight: weights.far_torso },
        { value: `${near}_arm`, weight: weights.near_arm },
        { value: `${far}_arm`, weight: weights.far_arm },
        { value: `${near}_leg`, weight: weights.near_leg },
        { value: `${far}_leg`, weight: weights.far_leg },
      ];

      tables[`${arc}:${near}`] = entries.filter((entry) => entry.weight > 0);
    }
  }

  return tables;
}
