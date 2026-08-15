import type { MechLocation } from '../schema/common';
import type { ArcProfile, AttackArc, CombatRules, Frame, Rules } from '../schema/rules';
import { ATTACK_ARCS, FRAMES } from '../schema/rules';
import { angleDifference, bearing } from './math';
import type { MechEntity, Vec2 } from './types';

const DEGREES_TO_RADIANS = Math.PI / 180;

/** Which flank the fire is coming in on. */
export type NearSide = 'left' | 'right';

/** Which plate a shot meets: the glacis, or the thin stuff over the reactor. */
export type ArmourFace = 'front' | 'rear';

/**
 * Side fire meets the front plate. The side arc is already paid for by its own
 * damage factor and its near-side hit table; a third pool would want a third
 * number on every location and a third bar on the paper doll to explain a
 * difference nobody would feel.
 */
export function armourFaceOf(arc: AttackArc): ArmourFace {
  return arc === 'rear' ? 'rear' : 'front';
}

export interface ArcHit {
  arc: AttackArc;
  near: NearSide;
}

export type ArcTableKey = `${AttackArc}:${NearSide}`;
export type ArcTables = Record<ArcTableKey, readonly { value: MechLocation; weight: number }[]>;

/** The three arc profiles for one kind of hull. */
export type ArcProfiles = Record<AttackArc, ArcProfile>;

/** Hit tables and arc damage, per frame, resolved once at world creation. */
export interface FrameArcs {
  profiles: ArcProfiles;
  tables: ArcTables;
}
export type FrameArcTables = Record<Frame, FrameArcs>;

/**
 * One set of tables per kind of hull.
 *
 * A mech falls through to `combat.attackArcs` untouched rather than to a copy
 * of it in frames.json: the surviving order of these arrays feeds the weighted
 * draw, so a frame that restated the mech weights could quietly move every hit
 * location in every battle the moment somebody tidied the file.
 */
export function buildFrameArcTables(rules: Rules): FrameArcTables {
  const mech: ArcProfiles = {
    front: rules.combat.attackArcs.front,
    side: rules.combat.attackArcs.side,
    rear: rules.combat.attackArcs.rear,
  };

  const built = {} as FrameArcTables;
  for (const frame of FRAMES) {
    const profiles = rules.frames.entries[frame].arcs ?? mech;
    built[frame] = { profiles, tables: buildArcTables(profiles) };
  }
  return built;
}

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
function buildArcTables(profiles: ArcProfiles): ArcTables {
  const tables = {} as ArcTables;

  for (const arc of ATTACK_ARCS) {
    for (const near of ['left', 'right'] as const) {
      const far = near === 'left' ? 'right' : 'left';
      const weights = profiles[arc].hitLocationWeights;

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
