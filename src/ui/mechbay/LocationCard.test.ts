import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { computeLoadout } from '../../sim/loadout';
import { LocationCard } from './LocationCard';

function render(location: 'left_arm' | 'right_torso', compatible: boolean): string {
  const design = catalog.designs.get('sentinel_brawler');
  const chassis = catalog.chassis.get('sentinel_snl2');
  if (design === undefined || chassis === undefined) throw new Error('missing Sentinel fixture');
  const loadout = computeLoadout(catalog, design);
  return renderToStaticMarkup(
    createElement(LocationCard, {
      catalog,
      chassis,
      design,
      location,
      usage: loadout.perLocation[location],
      armed: { kind: 'weapon', id: 'medium_laser' },
      compatible,
      onDrop: () => undefined,
      onRemoveMount: () => undefined,
      onRemoveAmmo: () => undefined,
      onRemoveEquipment: () => undefined,
    }),
  );
}

describe('armed hardpoint presentation', () => {
  it('marks only compatible weapon locations as placement targets', () => {
    const invalid = render('left_arm', false);
    const valid = render('right_torso', true);

    expect(invalid).not.toContain('armed-target');
    expect(invalid).toContain('disabled=""');
    expect(valid).toContain('armed-target');
    expect(valid).toContain('data-compatible="true"');
    expect(valid).not.toContain('disabled=""');
  });
});
