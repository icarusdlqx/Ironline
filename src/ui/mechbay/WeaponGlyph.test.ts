import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { Weapon } from '../../schema/weapon';
import { glyphProjectileCount, WeaponGlyph } from './WeaponGlyph';

function weapon(id: string): Weapon {
  const entry = catalog.weapons.get(id);
  if (entry === undefined) throw new Error(`missing weapon ${id}`);
  return entry;
}

function render(entry: Weapon): string {
  return renderToStaticMarkup(createElement(WeaponGlyph, { catalog, weapon: entry }));
}

describe('procedural weapon glyphs', () => {
  it.each([
    ['machine_gun', 'machine-guns'],
    ['flamer', 'flamers'],
    ['ac5', 'autocannons'],
    ['gauss_rifle', 'railguns'],
    ['medium_laser', 'lasers'],
    ['ppc', 'particle-weapons'],
    ['srm6', 'missile'],
    ['mrm20', 'missile'],
    ['lrm20', 'missile'],
  ])('draws %s with its own bounded family grammar', (id, family) => {
    const html = render(weapon(id));
    expect(html).toContain(`data-glyph-family="${family}"`);
    expect(html).toContain('<svg');
  });

  it('is decorative, inline, and independent of external assets', () => {
    const html = render(weapon('gauss_rifle'));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/href=|url\(|https?:\/\//);
  });

  it('caps launcher cells even when future data carries a huge salvo', () => {
    const oversized: Weapon = { ...weapon('lrm20'), projectiles: 10_000 };
    const html = render(oversized);
    expect(glyphProjectileCount(oversized.projectiles)).toBe(12);
    expect(html.match(/data-projectile-cell="true"/g)).toHaveLength(12);
    expect(html.length).toBeLessThan(4_000);
  });
});
