import type { Catalog } from '../../schema/load';
import type { Weapon } from '../../schema/weapon';
import { weaponSize, weaponSizeLabel } from '../../sim/loadout';

export interface Inspected {
  kind: 'weapon' | 'ammo' | 'equipment';
  id: string;
}

/** Heat one sink carries away per second, given the sink the design is using. */
function dissipationPerSink(catalog: Catalog, heatSinkId: string): number {
  const sink = catalog.equipment.get(heatSinkId);
  return (sink?.stats.dissipation ?? 1) * catalog.rules.heat.dissipationPerSinkPerSecond;
}

/**
 * What kind of bargain a weapon is, in one line. Derived from the type rather
 * than authored, because it is the same bargain every time: energy weapons buy
 * unlimited shots with heat, ballistics buy cool shooting with tonnage and a
 * finite magazine, missiles buy reach and arc with a magazine and travel time.
 */
function bargain(weapon: Weapon): string {
  if (weapon.type === 'energy') {
    return 'Never runs dry, and pays for every shot in heat. Sinks are the limit, not ammunition.';
  }
  if (weapon.type === 'ballistic') {
    return 'Barely warms the reactor, and stops entirely when the bin is empty. Heavy, and the ammunition can cook off.';
  }
  return 'Lobs over cover and hits in a cluster. Finite, slow in flight, and the bin is a liability under a breach.';
}

function round(value: number, places = 1): string {
  return value.toFixed(places).replace(/\.0$/, '');
}

/**
 * The card that explains a piece of kit: what it does, what it costs to run,
 * and how long it lasts. Nearly all of it is derived from the same numbers the
 * simulation uses, so it cannot drift away from what the weapon actually does
 * on the field.
 */
export function Dossier({
  catalog,
  inspected,
  heatSinkId,
}: {
  catalog: Catalog;
  inspected: Inspected | null;
  heatSinkId: string;
}) {
  if (inspected === null) {
    return (
      <div className="bay-dossier-card empty" data-testid="bay-dossier-card">
        <p>Pick a weapon to see what it does.</p>
      </div>
    );
  }

  if (inspected.kind === 'equipment') {
    const gear = catalog.equipment.get(inspected.id);
    if (gear === undefined) return null;
    return (
      <div className="bay-dossier-card" data-testid="bay-dossier-card">
        <h4>{gear.name}</h4>
        <p className="dossier-line">
          {gear.tonnage}t · {gear.slots} slot{gear.slots === 1 ? '' : 's'}
        </p>
        <p className="dossier-note">
          {Object.entries(gear.stats)
            .map(([key, value]) => `${key.replace(/_/g, ' ')} ${value}`)
            .join(' · ') || 'No listed effect.'}
        </p>
      </div>
    );
  }

  const weapon = catalog.weapons.get(inspected.id);
  if (weapon === undefined) return null;

  const volley = weapon.damage * weapon.projectiles;
  const perSecond = volley / weapon.cooldown;
  const heatPerSecond = weapon.heat / weapon.cooldown;
  const sinks = Math.ceil(heatPerSecond / dissipationPerSink(catalog, heatSinkId));
  // A ton of ammunition, spent as fast as the weapon will fire it.
  const seconds = weapon.ammoPerTon === null ? null : weapon.ammoPerTon * weapon.cooldown;

  return (
    <div className="bay-dossier-card" data-testid="bay-dossier-card">
      <h4>{weapon.name}</h4>
      <p className="dossier-line">
        {weaponSizeLabel(catalog, weaponSize(catalog, weapon))} {weapon.type} · {weapon.tonnage}t ·{' '}
        {weapon.slots} slot{weapon.slots === 1 ? '' : 's'}
      </p>

      <dl className="dossier-stats">
        <div>
          <dt>Firepower</dt>
          <dd>
            {round(volley)} a volley
            {weapon.projectiles > 1 ? ` (${weapon.projectiles} × ${round(weapon.damage)})` : ''} ·{' '}
            {round(perSecond)}/s
          </dd>
        </div>
        <div>
          <dt>Heat</dt>
          <dd className={sinks >= 6 ? 'hot' : undefined}>
            {round(weapon.heat)} a shot · {round(heatPerSecond, 2)}/s ·{' '}
            {sinks === 0 ? 'no sinks needed' : `${sinks} sink${sinks === 1 ? '' : 's'} to hold it`}
          </dd>
        </div>
        <div>
          <dt>Ammunition</dt>
          <dd>
            {weapon.ammoPerTon === null
              ? 'None — fires on reactor power'
              : `${weapon.ammoPerTon} rounds a ton · about ${Math.round((seconds ?? 0) / 6) * 6}s of firing`}
          </dd>
        </div>
        <div>
          <dt>Reach</dt>
          <dd>
            {weapon.range.short}m short · {weapon.range.medium}m medium · {weapon.range.long}m long
            {weapon.range.min > 0 ? ` · dead inside ${weapon.range.min}m` : ''}
          </dd>
        </div>
      </dl>

      <p className="dossier-note">{weapon.summary}</p>
      <p className="dossier-bargain">{bargain(weapon)}</p>
    </div>
  );
}
