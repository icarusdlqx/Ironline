import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { playerWorld } from '../../tests/support';
import { snapshotUnit } from './snapshot';
import { TacticalReadout } from './TacticalReadout';

describe('TacticalReadout', () => {
  it('puts the selected pilot and reactor decisions into the panel', () => {
    const world = playerWorld('readout-panel');
    const mech = world.entities.find((entity) => entity.team === 0);
    if (mech === undefined) throw new Error('no player mech');
    mech.ability.id = 'aimed_volley';
    mech.ability.readyAtTick = world.tick + Math.round(5 / world.dt);
    mech.heat = mech.heatCapacity * 0.99;
    mech.groupIntent[1] = true;
    mech.groupEnabled[1] = false;

    const html = renderToStaticMarkup(
      createElement(TacticalReadout, { unit: snapshotUnit(world, mech) }),
    );

    expect(html).toContain('Aimed Volley');
    expect(html).toContain('5.0s COOLDOWN');
    expect(html).toContain('Stability');
    expect(html).toContain('forced-shutdown band');
    expect(html).toContain('SHEDDING G2');
  });
});
