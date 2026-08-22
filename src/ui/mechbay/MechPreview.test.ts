import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { MechLocation } from '../../schema/common';
import { MechPreview } from './MechPreview';

describe('mech preview host', () => {
  it('is server-safe and preserves the integration class without constructing WebGL', () => {
    const design = catalog.designs.get('sentinel_brawler');
    const chassis = catalog.chassis.get('sentinel_snl2');
    if (design === undefined || chassis === undefined) throw new Error('missing Sentinel fixture');

    const html = renderToStaticMarkup(createElement(MechPreview, {
      catalog,
      chassis,
      design,
      className: 'bay-machine',
      compatible: new Set<MechLocation>(['left_arm']),
    }));

    expect(html).toContain('class="mech-preview bay-machine"');
    expect(html).toContain('data-testid="mech-preview"');
    expect(html).not.toContain('canvas');
  });
});
