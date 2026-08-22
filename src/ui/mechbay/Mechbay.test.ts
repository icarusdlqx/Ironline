import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { compatibleLocations } from './bayFit';
import { guidedWeaponId, Mechbay } from './Mechbay';

describe('campaign cooling inventory', () => {
  it('does not offer a heat-sink type the company does not own', () => {
    const design = catalog.designs.get('sentinel_brawler');
    if (design === undefined) throw new Error('missing Sentinel design');

    const html = renderToStaticMarkup(
      createElement(Mechbay, {
        onExit: () => undefined,
        commission: {
          title: design.name,
          cancelLabel: 'Back to hangar',
          design,
          inventory: new Map([[design.heatSinkId, design.heatSinks]]),
          onCommit: () => ({ ok: true, reason: null }),
          onCancel: () => undefined,
        },
      }),
    );

    expect(html).toContain('Heat Sink');
    expect(html).not.toContain('Compound Heat Sink');
    expect(html).toContain('Back to hangar');
  });
});

describe('mechbay presentation', () => {
  it('keeps the armed weapon guidance while another card is hovered', () => {
    const design = catalog.designs.get('sentinel_brawler');
    if (design === undefined) throw new Error('missing Sentinel design');

    const weaponId = guidedWeaponId(
      { kind: 'weapon', id: 'medium_laser' },
      'ac5',
    );

    expect(compatibleLocations(catalog, design, 'ac5')).toEqual([]);
    expect(weaponId).toBe('medium_laser');
    expect(compatibleLocations(catalog, design, weaponId ?? '')).toEqual(['right_torso']);
  });

  it('renders the live-preview host, selectable locations, and grouped weapon cards', () => {
    const html = renderToStaticMarkup(
      createElement(Mechbay, { onExit: () => undefined }),
    );

    expect(html).toContain('data-testid="mech-preview"');
    expect(html.match(/class="bay-location-name"/g)).toHaveLength(8);
    expect(html).toContain('Long-Range Missiles');
    expect(html).toContain('Machine Guns');
    expect(html).toContain('Lasers');
    expect(html).toContain('Aurelian Stock');
    expect(html).toContain('Linewrought');
    expect(html).toContain('role="meter"');
    expect(html).not.toMatch(/dead inside|Lobs over cover/);
  });
});
