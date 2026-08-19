import { describe, expect, it } from 'vitest';
import { startCampaign } from './campaign';
import { mechIntegrity } from './integrity';
import { pristineCondition } from './repair';
import { catalog } from '../../tests/support';

describe('campaign mech integrity', () => {
  it('reports a pristine machine at full integrity', () => {
    const state = startCampaign(catalog, 'border_dispute', 'integrity-pristine');
    const mech = state.mechs[0];
    if (mech === undefined) throw new Error('the company has no mech');

    expect(mechIntegrity(catalog, mech)).toMatchObject({ fraction: 1 });
  });

  it('keeps the denominator fixed when internal structure is lost', () => {
    const state = startCampaign(catalog, 'border_dispute', 'integrity-structure');
    const mech = state.mechs[0];
    if (mech === undefined) throw new Error('the company has no mech');
    const pristine = mechIntegrity(catalog, mech);

    mech.condition.centre_torso.internal = Math.max(
      0,
      mech.condition.centre_torso.internal - 10,
    );
    const damaged = mechIntegrity(catalog, mech);

    expect(damaged.maximum).toBe(pristine.maximum);
    expect(damaged.current).toBe(pristine.current - 10);
    expect(damaged.fraction).toBe((pristine.current - 10) / pristine.maximum);
  });

  it('uses the refitted armour maximum rather than an old condition total', () => {
    const state = startCampaign(catalog, 'border_dispute', 'integrity-refit');
    const mech = state.mechs[0];
    if (mech === undefined) throw new Error('the company has no mech');
    mech.design.armour.left_arm = Math.max(0, mech.design.armour.left_arm - 8);
    mech.condition = pristineCondition(catalog, mech.design);

    const integrity = mechIntegrity(catalog, mech);
    expect(integrity.current).toBe(integrity.maximum);
    expect(integrity.fraction).toBe(1);
  });
});
