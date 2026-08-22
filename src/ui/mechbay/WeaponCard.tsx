import type { DragEvent } from 'react';
import type { Faction } from '../../schema/faction';
import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';
import { RangeBandStrip } from './RangeBandStrip';
import { WeaponGlyph } from './WeaponGlyph';
import {
  factionPresentation,
  formatWeaponNumber,
  isForeignPattern,
  normalisedWeaponMetrics,
  weaponCategory,
  weaponCategoryLabel,
  weaponCostLine,
  weaponMetricMaxima,
  weaponMetrics,
  weaponOperatingLine,
  weaponTraitLines,
  type NormalisedWeaponMetrics,
  type WeaponMetrics,
} from './weaponPresentation';

export interface WeaponCardProps {
  catalog: Catalog;
  weapon: Weapon;
  mountedWeapons?: readonly Weapon[];
  chassisFaction?: Faction;
  stock?: number;
  selected?: boolean;
  unavailableReason?: string | null;
  className?: string;
  testId?: string;
  onPick?: (weapon: Weapon) => void;
  onInspect?: (weapon: Weapon) => void;
  onHover?: (hovered: boolean) => void;
  onWeaponDragStart?: (weapon: Weapon, event: DragEvent<HTMLButtonElement>) => void;
}

interface MeterProps {
  label: 'Damage' | 'Reach' | 'Heat';
  value: number;
  maximum: number;
  fill: number;
  valueText: string;
  display: string;
  warning?: boolean;
}

function WeaponMeter({
  label,
  value,
  maximum,
  fill,
  valueText,
  display,
  warning = false,
}: MeterProps) {
  return (
    <span
      className={`weapon-card__meter${warning ? ' is-warning' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={maximum}
      aria-valuenow={value}
      aria-valuetext={valueText}
    >
      <span className="weapon-card__meter-label">{label}</span>
      <span className="weapon-card__meter-value">{display}</span>
      <span className="weapon-card__meter-track" aria-hidden="true">
        <span style={{ width: `${fill * 100}%` }} />
      </span>
    </span>
  );
}

function WeaponMeters({
  metrics,
  maxima,
  normalised,
}: {
  metrics: WeaponMetrics;
  maxima: WeaponMetrics;
  normalised: NormalisedWeaponMetrics;
}) {
  const damage = formatWeaponNumber(metrics.damage);
  const reach = formatWeaponNumber(metrics.reach);
  const heat = formatWeaponNumber(metrics.heat);
  return (
    <span className="weapon-card__meters">
      <WeaponMeter
        label="Damage"
        value={metrics.damage}
        maximum={maxima.damage}
        fill={normalised.damage}
        valueText={`${damage} damage per second`}
        display={`${damage}/s`}
      />
      <WeaponMeter
        label="Reach"
        value={metrics.reach}
        maximum={maxima.reach}
        fill={normalised.reach}
        valueText={`${reach} metres`}
        display={`${reach}m`}
      />
      <WeaponMeter
        label="Heat"
        value={metrics.heat}
        maximum={maxima.heat}
        fill={normalised.heat}
        valueText={`${heat} heat per second; higher is hotter`}
        display={`${heat}/s`}
        warning
      />
    </span>
  );
}

export function WeaponCard({
  catalog,
  weapon,
  mountedWeapons = [],
  chassisFaction,
  stock,
  selected = false,
  unavailableReason = null,
  className = '',
  testId,
  onPick,
  onInspect,
  onHover,
  onWeaponDragStart,
}: WeaponCardProps) {
  const category = weaponCategory(catalog, weapon);
  const faction = factionPresentation(weapon.faction);
  const foreign = isForeignPattern(weapon, chassisFaction);
  const exhausted = stock !== undefined && stock <= 0;
  const unavailable = exhausted || unavailableReason !== null;
  const reason = exhausted ? 'None left in stores.' : unavailableReason;
  const maxima = weaponMetricMaxima(catalog);
  const metrics = weaponMetrics(weapon);
  const normalised = normalisedWeaponMetrics(weapon, maxima);
  const traits = weaponTraitLines(catalog, weapon);
  const classes = [
    'weapon-card',
    faction.className,
    selected ? 'is-selected' : '',
    unavailable ? 'is-unavailable' : '',
    foreign ? 'is-foreign' : '',
    className,
  ].filter(Boolean);

  return (
    <article
      className={classes.join(' ')}
      data-testid={`weapon-card-${weapon.id}`}
      data-weapon-category={category}
      data-faction={weapon.faction}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <button
        type="button"
        className="weapon-card__pick"
        data-testid={testId}
        draggable={!unavailable}
        aria-pressed={selected}
        aria-disabled={unavailable || undefined}
        aria-label={`${weapon.name}, ${faction.label}, ${weaponCategoryLabel(category)}`}
        title={reason ?? undefined}
        onFocus={() => {
          onInspect?.(weapon);
          onHover?.(true);
        }}
        onBlur={() => onHover?.(false)}
        onClick={() => {
          onInspect?.(weapon);
          if (!unavailable) onPick?.(weapon);
        }}
        onDragStart={(event) => {
          if (unavailable) {
            event.preventDefault();
            return;
          }
          onInspect?.(weapon);
          event.dataTransfer.setData(
            'application/ironline',
            JSON.stringify({ kind: 'weapon', id: weapon.id }),
          );
          event.dataTransfer.effectAllowed = 'copy';
          onWeaponDragStart?.(weapon, event);
        }}
      >
        <span className="weapon-card__heading">
          <WeaponGlyph catalog={catalog} weapon={weapon} />
          <span className="weapon-card__identity">
            <strong>{weapon.name}</strong>
            <span className="weapon-card__category">{weaponCategoryLabel(category)}</span>
          </span>
          {stock === undefined ? null : (
            <span className="weapon-card__stock">×{Math.max(0, stock)}</span>
          )}
        </span>

        <span className="weapon-card__badges">
          <span className="weapon-card__faction-badge">{faction.label}</span>
          {foreign ? <span className="weapon-card__foreign-badge">Foreign pattern</span> : null}
        </span>

        <WeaponMeters metrics={metrics} maxima={maxima} normalised={normalised} />
        <span className="weapon-card__cost">{weaponCostLine(weapon)}</span>
        <span className="weapon-card__operating-line">{weaponOperatingLine(weapon)}</span>
        {traits.length === 0 ? null : (
          <span className="weapon-card__traits">
            {traits.map((trait) => (
              <span key={trait} className="weapon-card__trait">
                {trait}
              </span>
            ))}
          </span>
        )}
        <RangeBandStrip catalog={catalog} weapon={weapon} mountedWeapons={mountedWeapons} />
        {reason === null ? null : <span className="weapon-card__unavailable-reason">{reason}</span>}
      </button>
    </article>
  );
}
