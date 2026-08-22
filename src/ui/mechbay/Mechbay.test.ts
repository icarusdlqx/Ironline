import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { Mechbay } from './Mechbay';

describe('campaign cooling inventory', () => {
  it('does not offer a heat-sink type the company does not own', () => {
    const design = catalog.designs.get('sentinel_brawler');
    if (design === undefined) throw new Error('missing Sentinel design');

    const html = renderToStaticMarkup(
      createElement(Mechbay, {
        onExit: () => undefined,
        commission: {
          title: design.name,
          design,
          inventory: new Map([[design.heatSinkId, design.heatSinks]]),
          onCommit: () => ({ ok: true, reason: null }),
          onCancel: () => undefined,
        },
      }),
    );

    expect(html).toContain('Heat Sink');
    expect(html).not.toContain('Compound Heat Sink');
  });
});
