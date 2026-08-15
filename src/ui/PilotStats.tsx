import type { Catalog } from '../schema/load';
import { sensorRangeFor } from '../sim/sensors';

/**
 * Enough of a pilot to rate them. Both the campaign's roster records and the
 * catalogue's authored pilots satisfy this, which is what lets the briefing and
 * the dropship manifest show the same five bars.
 */
export interface RateablePilot {
  gunnery: number;
  piloting: number;
  sensors: number;
  traits: string[];
}

export interface PilotStat {
  label: string;
  /** Out of ten, because a five-point scale reads as a rounding error in a bar. */
  score: number;
  /** What the number actually buys, in the units the player sees on the field. */
  effect: string;
}

const MAX_SKILL = 5;
const SCALE = 10;

/** The product of a pilot's specialities on one factor. */
function traitProduct(
  catalog: Catalog,
  pilot: RateablePilot,
  key: 'survivalFactor' | 'criticalChanceFactor' | 'accuracyFactor' | 'dissipationFactor',
): number {
  let factor = 1;
  for (const id of pilot.traits) {
    const trait = catalog.rules.pilotTraits.entries[id];
    if (trait !== undefined) factor *= trait[key];
  }
  return factor;
}

/**
 * Turns a multiplier around 1 into a ten-point rating, 5 being unremarkable.
 *
 * `lowerIsBetter` is not decoration: survivalFactor multiplies the chance of
 * dying, so the toughest pilot in the company carries the smallest number, and
 * rating it straight showed the one with Hard to Kill as the most fragile.
 */
function rateFactor(factor: number, spread: number, lowerIsBetter = false): number {
  const merit = lowerIsBetter ? 1 - (factor - 1) : factor;
  const rating = SCALE / 2 + ((merit - 1) / spread) * (SCALE / 2);
  return Math.max(1, Math.min(SCALE, Math.round(rating)));
}

/**
 * The five numbers that decide what a pilot is worth in a mech. The three
 * skills are what the campaign trains; the last two are what their specialities
 * add, which is the difference between two people with the same gunnery rating.
 */
export function pilotStats(catalog: Catalog, pilot: RateablePilot): PilotStat[] {
  const combat = catalog.rules.combat;
  const base = combat.gunneryBase[pilot.gunnery - 1] ?? combat.gunneryBase[0] ?? 0.5;
  const accuracy = traitProduct(catalog, pilot, 'accuracyFactor');
  const shutdown = Math.max(0, 1 - pilot.piloting * catalog.rules.heat.pilotingOverrideFactor);
  const footing = Math.max(
    0,
    1 - pilot.piloting * catalog.rules.stability.pilotingResistFactor,
  );

  return [
    {
      label: 'Gunnery',
      score: Math.round((pilot.gunnery / MAX_SKILL) * SCALE),
      effect: `${Math.round(base * accuracy * 100)}% base hit chance`,
    },
    {
      label: 'Piloting',
      score: Math.round((pilot.piloting / MAX_SKILL) * SCALE),
      effect: `${Math.round(footing * 100)}% of a shove lands, ${Math.round(shutdown * 100)}% shutdown risk`,
    },
    {
      label: 'Sensors',
      score: Math.round((pilot.sensors / MAX_SKILL) * SCALE),
      effect: `${Math.round(sensorRangeFor(catalog.rules.sensors, pilot.sensors))}m detection`,
    },
    {
      label: 'Killer',
      score: rateFactor(traitProduct(catalog, pilot, 'criticalChanceFactor'), 0.5),
      effect: 'how often their fire finds something behind the plate',
    },
    {
      label: 'Nerve',
      score: rateFactor(traitProduct(catalog, pilot, 'survivalFactor'), 0.5, true),
      effect: 'their odds of walking away from a wreck',
    },
  ];
}

/**
 * Five bars and five numbers. A pilot the player cannot rate at a glance is a
 * name, and choosing between names is not a decision.
 */
export function PilotStats({
  catalog,
  pilot,
  compact = false,
}: {
  catalog: Catalog;
  pilot: RateablePilot;
  compact?: boolean;
}) {
  const stats = pilotStats(catalog, pilot);

  return (
    <ul className={`pilot-stats ${compact ? 'compact' : ''}`} data-testid="pilot-stats">
      {stats.map((stat) => (
        <li key={stat.label} title={`${stat.label} ${stat.score}/10 — ${stat.effect}`}>
          <span className="stat-label">{stat.label}</span>
          <span className="stat-bar">
            <span style={{ width: `${(stat.score / SCALE) * 100}%` }} />
          </span>
          <span className="stat-score">{stat.score}</span>
        </li>
      ))}
    </ul>
  );
}
