import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import {
  factionPresentation,
  normalisedWeaponMetrics,
  weaponCategory,
  weaponCostLine,
  weaponMetricMaxima,
  weaponMetrics,
  weaponOperatingLine,
  weaponTraitLines,
  weaponsByCategory,
  type WeaponCategory,
} from './weaponPresentation';

function weapon(id: string) {
  const entry = catalog.weapons.get(id);
  if (entry === undefined) throw new Error(`missing weapon ${id}`);
  return entry;
}

describe('weapon categories', () => {
  it('places every catalogue weapon in exactly one plain-English family', () => {
    const expected: Record<WeaponCategory, number> = {
      'machine-guns': 1,
      flamers: 1,
      'short-range-missiles': 3,
      autocannons: 3,
      'medium-range-missiles': 1,
      lasers: 9,
      'particle-weapons': 3,
      railguns: 1,
      'long-range-missiles': 2,
    };
    const groups = weaponsByCategory(catalog, [...catalog.weapons.values()]);
    const actual = Object.fromEntries(
      [...groups].map(([category, entries]) => [category, entries.length]),
    );

    expect(actual).toEqual(expected);
    expect([...groups.values()].flat()).toHaveLength(catalog.weapons.size);
  });

  it('keeps the catalogue exceptions out of misleading catch-all groups', () => {
    expect(weaponCategory(catalog, weapon('flamer'))).toBe('flamers');
    expect(weaponCategory(catalog, weapon('gauss_rifle'))).toBe('railguns');
    expect(weaponCategory(catalog, weapon('mrm20'))).toBe('medium-range-missiles');
    expect(weaponCategory(catalog, weapon('lrm20'))).toBe('long-range-missiles');
  });
});

describe('weapon comparison metrics', () => {
  it('uses fixed whole-catalogue maxima', () => {
    const maxima = weaponMetricMaxima(catalog);
    expect(maxima).toEqual({ damage: 10.25, reach: 540, heat: 4.5 });
  });

  it('measures sustained damage, authored reach, and sustained heat', () => {
    expect(weaponMetrics(weapon('lrm20'))).toEqual({ damage: 10.25, reach: 540, heat: 1.5 });
    expect(weaponMetrics(weapon('machine_gun'))).toEqual({ damage: 1.2, reach: 90, heat: 1 });
  });

  it('keeps every fill bounded without changing maxima with a shelf filter', () => {
    const maxima = weaponMetricMaxima(catalog);
    const filtered = [...catalog.weapons.values()].filter((entry) => entry.type === 'energy');
    const fills = filtered.map((entry) => normalisedWeaponMetrics(entry, maxima));

    for (const metrics of fills) {
      expect(Object.values(metrics).every((value) => value >= 0 && value <= 1)).toBe(true);
    }
    expect(maxima).toEqual(weaponMetricMaxima(catalog));
  });
});

describe('truthful generated copy', () => {
  it('states fitting, heat and ammunition burdens without arithmetic', () => {
    expect(weaponCostLine(weapon('ac5'))).toBe(
      '8 tons, 4 slots; adds 0.5 heat/s; 1 ton of ammo lasts 40s at full cycle.',
    );
    expect(weaponCostLine(weapon('large_laser'))).toBe(
      '5 tons, 2 slots; adds 2.29 heat/s; needs no ammunition.',
    );
  });

  it('does not pretend the simulated flamer has an ammunition bin', () => {
    expect(weaponCostLine(weapon('flamer'))).toContain('no separate fuel bin is tracked');
    expect(weaponOperatingLine(weapon('flamer'))).toContain('loadout tracks no separate fuel bin');
    expect(weaponTraitLines(catalog, weapon('flamer'))).toContain('Adds 4 heat to the target');
  });

  it('describes the real minimum-range modifier and never promises indirect fire', () => {
    expect(weaponTraitLines(catalog, weapon('ppc'))).toContain('50% accuracy inside 30m');
    const generated = [...catalog.weapons.values()]
      .flatMap((entry) => [
        weaponCostLine(entry),
        weaponOperatingLine(entry),
        ...weaponTraitLines(catalog, entry),
      ])
      .join(' ')
      .toLowerCase();
    expect(generated).not.toMatch(/dead inside|lobs over cover|indirect fire|reactor power/);
    expect(weaponOperatingLine(weapon('lrm10'))).toContain('line of sight is still required');
  });

  it('exposes faction labels for text-and-colour treatment', () => {
    expect(factionPresentation('linewrought')).toEqual({
      label: 'Linewrought',
      className: 'faction-linewrought',
    });
    expect(factionPresentation('aurelian').label).toBe('Aurelian Stock');
  });
});
