import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';
import { formatWeaponNumber } from './weaponPresentation';

export interface RangeBandStripProps {
  catalog: Catalog;
  weapon: Weapon;
  mountedWeapons?: readonly Weapon[];
  className?: string;
}

export interface MountedReachMark {
  reach: number;
  count: number;
}

function percent(value: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maximum) * 100));
}

export function mountedRangeMarks(mountedWeapons: readonly Weapon[]): readonly MountedReachMark[] {
  const counts = new Map<number, number>();
  for (const mounted of mountedWeapons) {
    counts.set(mounted.range.long, (counts.get(mounted.range.long) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([reach, count]) => ({ reach, count }));
}

export function mountedRangeEnvelope(mountedWeapons: readonly Weapon[]): number | null {
  let envelope: number | null = null;
  for (const mounted of mountedWeapons) {
    envelope = Math.max(envelope ?? 0, mounted.range.long);
  }
  return envelope;
}

export function rangeComparisonLine(
  candidate: Weapon,
  mountedWeapons: readonly Weapon[],
): string {
  const candidateReach = formatWeaponNumber(candidate.range.long);
  const envelope = mountedRangeEnvelope(mountedWeapons);
  if (envelope === null) return `Sets a ${candidateReach}m battery envelope.`;
  const mountedReach = formatWeaponNumber(envelope);
  if (candidate.range.long > envelope) {
    return `Extends the battery from ${mountedReach}m to ${candidateReach}m.`;
  }
  if (candidate.range.long === envelope) {
    return `Matches the longest mounted weapon at ${candidateReach}m.`;
  }
  return `Works inside the current ${mountedReach}m envelope.`;
}

export function rangeBandSummary(catalog: Catalog, weapon: Weapon): string {
  const factors = catalog.rules.combat.rangeFactor;
  const brackets = [
    `full range accuracy to ${formatWeaponNumber(weapon.range.short)}m`,
    `${Math.round(factors.medium * 100)}% through ${formatWeaponNumber(weapon.range.medium)}m`,
    `${Math.round(factors.long * 100)}% through ${formatWeaponNumber(weapon.range.long)}m`,
  ];
  if (weapon.range.min > 0) {
    brackets.push(
      `${Math.round(catalog.rules.combat.minimumRangeFactor * 100)}% minimum-range modifier inside ${formatWeaponNumber(weapon.range.min)}m`,
    );
  }
  return brackets.join('; ');
}

export function RangeBandStrip({
  catalog,
  weapon,
  mountedWeapons = [],
  className = '',
}: RangeBandStripProps) {
  const marks = mountedRangeMarks(mountedWeapons);
  const envelope = mountedRangeEnvelope(mountedWeapons);
  // The meters keep one catalogue-wide scale. This close comparison ends at
  // the longer battery envelope so short-range breakpoints remain legible.
  const maximum = Math.max(1, weapon.range.long, envelope ?? 0);
  const comparison = rangeComparisonLine(weapon, mountedWeapons);
  const summary = rangeBandSummary(catalog, weapon);
  const segments = [
    { key: 'minimum', start: 0, end: weapon.range.min },
    { key: 'short', start: weapon.range.min, end: weapon.range.short },
    { key: 'medium', start: weapon.range.short, end: weapon.range.medium },
    { key: 'long', start: weapon.range.medium, end: weapon.range.long },
  ] as const;
  const ticks = [
    ...(weapon.range.min > 0 ? [{ key: 'min', value: weapon.range.min }] : []),
    { key: 'short', value: weapon.range.short },
    { key: 'medium', value: weapon.range.medium },
    { key: 'long', value: weapon.range.long },
  ];

  return (
    <span
      className={`weapon-range-strip ${className}`.trim()}
      role="img"
      aria-label={`${weapon.name} range: ${summary}. ${comparison}`}
      data-range-maximum={maximum}
    >
      <span className="weapon-range-strip__candidate" aria-hidden="true">
        {segments.map((segment) =>
          segment.end <= segment.start ? null : (
            <span
              key={segment.key}
              className={`weapon-range-strip__segment is-${segment.key}`}
              data-range-segment={segment.key}
              style={{
                left: `${percent(segment.start, maximum)}%`,
                width: `${percent(segment.end - segment.start, maximum)}%`,
              }}
            />
          ),
        )}
        {ticks.map((tick) => (
          <span
            key={tick.key}
            className={`weapon-range-strip__tick is-${tick.key}`}
            data-range-tick={tick.key}
            style={{ left: `${percent(tick.value, maximum)}%` }}
          >
            {formatWeaponNumber(tick.value)}m
          </span>
        ))}
      </span>

      <span className="weapon-range-strip__mounted" aria-hidden="true">
        {envelope === null ? null : (
          <span
            className="weapon-range-strip__envelope"
            style={{ width: `${percent(envelope, maximum)}%` }}
          />
        )}
        {marks.map((mark) => (
          <span
            key={mark.reach}
            className="weapon-range-strip__mounted-mark"
            data-mounted-count={mark.count}
            style={{ left: `${percent(mark.reach, maximum)}%` }}
          >
            {mark.count > 1 ? `×${mark.count}` : ''}
          </span>
        ))}
      </span>
      <span className="weapon-range-strip__comparison">{comparison}</span>
    </span>
  );
}
