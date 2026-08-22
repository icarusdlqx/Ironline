import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { Weapon } from '../../schema/weapon';
import {
  mountedRangeEnvelope,
  mountedRangeMarks,
  rangeBandSummary,
  rangeComparisonLine,
  RangeBandStrip,
} from './RangeBandStrip';

function weapon(id: string): Weapon {
  const entry = catalog.weapons.get(id);
  if (entry === undefined) throw new Error(`missing weapon ${id}`);
  return entry;
}

describe('mounted range comparison', () => {
  it('describes an empty, extended, matched, or enclosing battery', () => {
    expect(rangeComparisonLine(weapon('ac5'), [])).toBe('Sets a 360m battery envelope.');
    expect(rangeComparisonLine(weapon('ac5'), [weapon('srm6')])).toBe(
      'Extends the battery from 150m to 360m.',
    );
    expect(rangeComparisonLine(weapon('ac5'), [weapon('lbx_ac10')])).toBe(
      'Matches the longest mounted weapon at 360m.',
    );
    expect(rangeComparisonLine(weapon('srm6'), [weapon('ac5')])).toBe(
      'Works inside the current 360m envelope.',
    );
  });

  it('groups repeated endpoints without losing the battery envelope', () => {
    const mounted = [weapon('srm6'), weapon('streak_srm6'), weapon('ac5')];
    expect(mountedRangeMarks(mounted)).toEqual([
      { reach: 150, count: 2 },
      { reach: 360, count: 1 },
    ]);
    expect(mountedRangeEnvelope(mounted)).toBe(360);
  });
});

describe('range-band strip', () => {
  it('uses the local battery envelope and exposes authored breakpoints', () => {
    const html = renderToStaticMarkup(
      createElement(RangeBandStrip, {
        catalog,
        weapon: weapon('lrm10'),
        mountedWeapons: [weapon('srm6'), weapon('streak_srm6')],
      }),
    );
    expect(html).toContain('data-range-maximum="540"');
    expect(html).toContain('data-range-segment="minimum"');
    expect(html).toContain('data-range-tick="min"');
    expect(html).toContain('data-range-tick="long"');
    expect(html).toContain('data-mounted-count="2"');
    expect(html).toContain('Extends the battery from 150m to 540m.');
  });

  it('keeps a short-range candidate on the fitted battery scale', () => {
    const html = renderToStaticMarkup(
      createElement(RangeBandStrip, {
        catalog,
        weapon: weapon('flamer'),
        mountedWeapons: [weapon('ac5')],
      }),
    );

    expect(html).toContain('data-range-maximum="360"');
    expect(html).toContain('Works inside the current 360m envelope.');
  });

  it('states the actual accuracy modifiers instead of calling minimum range dead', () => {
    const summary = rangeBandSummary(catalog, weapon('lrm10'));
    expect(summary).toBe(
      'full range accuracy to 180m; 82% through 350m; 58% through 540m; 50% minimum-range modifier inside 60m',
    );
    expect(summary).not.toContain('dead');

    const html = renderToStaticMarkup(
      createElement(RangeBandStrip, { catalog, weapon: weapon('lrm10') }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Longshot 10 range:');
  });
});
