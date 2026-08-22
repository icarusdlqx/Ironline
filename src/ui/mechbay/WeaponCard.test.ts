import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { Weapon } from '../../schema/weapon';
import { WeaponCard } from './WeaponCard';

function weapon(id: string): Weapon {
  const entry = catalog.weapons.get(id);
  if (entry === undefined) throw new Error(`missing weapon ${id}`);
  return entry;
}

function render(id: string, extra: Partial<Parameters<typeof WeaponCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(WeaponCard, {
      catalog,
      weapon: weapon(id),
      ...extra,
    }),
  );
}

describe('weapon card', () => {
  it('is a native keyboard-operable button with drag payload support', () => {
    const html = render('ac5', { selected: true });
    expect(html).toContain('<button type="button" class="weapon-card__pick"');
    expect(html).toContain('type="button"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-testid="weapon-card-ac5"');
  });

  it('renders exactly three numeric accessible comparison meters', () => {
    const html = render('lrm20');
    expect(html.match(/role="meter"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Damage"');
    expect(html).toContain('aria-label="Reach"');
    expect(html).toContain('aria-label="Heat"');
    expect(html).toContain('aria-valuetext="10.25 damage per second"');
    expect(html).toContain('aria-valuetext="540 metres"');
    expect(html).toContain('higher is hotter');
    expect(html.indexOf('</button>')).toBeGreaterThan(html.indexOf('role="meter"'));
  });

  it('uses faction text as well as tint and marks foreign-pattern equipment', () => {
    const foreign = render('large_laser', { chassisFaction: 'linewrought' });
    expect(foreign).toContain('data-faction="aurelian"');
    expect(foreign).toContain('faction-aurelian');
    expect(foreign).toContain('Aurelian Stock');
    expect(foreign).toContain('Foreign pattern');

    const domestic = render('large_laser', { chassisFaction: 'aurelian' });
    expect(domestic).not.toContain('Foreign pattern');
  });

  it('shows current-stat costs and truthful missile and minimum-range copy', () => {
    const html = render('lrm10', { mountedWeapons: [weapon('srm6')] });
    expect(html).toContain('5 tons, 2 slots; adds 1 heat/s;');
    expect(html).toContain('1 ton of ammo lasts 48s at full cycle.');
    expect(html).toContain('line of sight is still required');
    expect(html).toContain('50% accuracy inside 60m');
    expect(html).not.toMatch(/dead inside|Lobs over cover|indirect fire/);
  });

  it('keeps unavailable cards inspectable but prevents activation and dragging', () => {
    const html = render('gauss_rifle', {
      unavailableReason: 'Needs a heavy ballistic mount.',
      stock: 2,
    });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('draggable="false"');
    expect(html).toContain('Needs a heavy ballistic mount.');
    expect(html).toContain('×2');
  });
});
