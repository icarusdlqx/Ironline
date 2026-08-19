import { describe, expect, it } from 'vitest';
import { LOCATIONS } from '../schema/common';
import { catalog } from '../../tests/support';
import { advanceDays, startCampaign } from './campaign';
import { deployableLance } from './deployment';
import { fitFromStore, rebuildHulk } from './refit';
import { estimateRepair } from './repair';
import { assign } from './roster';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { recoveredHulk } from './salvagedHull';
import { addToStore, type RecoveredHull } from './types';

function fieldHull(): RecoveredHull {
  return {
    designId: 'sentinel_brawler',
    condition: Object.fromEntries(
      LOCATIONS.map((location, index) => [
        location,
        { armour: index + 1, rearArmour: 0, internal: index + 2, destroyed: location === 'head' },
      ]),
    ) as RecoveredHull['condition'],
  };
}

describe('recovered campaign hull', () => {
  it('keeps its field damage and arrives without duplicated loose parts', () => {
    const source = fieldHull();
    const mech = recoveredHulk(catalog, source, 'mech-salvage', 7);
    if (mech === null) throw new Error('the salvage design is missing');

    expect(mech).toMatchObject({ id: 'mech-salvage', status: 'hulk', readyOnDay: 7 });
    expect(mech.condition).toEqual(source.condition);
    expect(mech.condition).not.toBe(source.condition);
    expect(mech.design.armour).toEqual(catalog.designs.get(source.designId)?.armour);
    expect(mech.design.heatSinks).toBe(
      catalog.chassis.get(mech.design.chassisId)?.internalHeatSinks,
    );
    expect(mech.design.mounts).toEqual([]);
    expect(mech.design.ammo).toEqual([]);
    expect(mech.design.equipment).toEqual([]);
    expect(mech.rebuildCost).toBeGreaterThan(0);
  });

  it('does not invent a hull for an unknown recovered design', () => {
    expect(recoveredHulk(catalog, { ...fieldHull(), designId: 'missing' }, 'mech-x', 0)).toBeNull();
  });

  it('round-trips a stripped wreck through the existing campaign save', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvaged-hull-save');
    const mech = recoveredHulk(catalog, fieldHull(), 'mech-salvage', state.day);
    if (mech === null) throw new Error('the salvage design is missing');
    state.mechs.push(mech);

    const restored = deserialiseCampaign(serialiseCampaign(state), catalog).state;
    const saved = restored?.mechs.find((entry) => entry.id === mech.id);
    expect(saved?.condition).toEqual(mech.condition);
    expect(saved?.design.mounts).toEqual([]);
    expect(saved?.design.ammo).toEqual([]);
    expect(saved?.design.equipment).toEqual([]);
  });

  it('keeps an unarmed rebuild in the bay until a real weapon is fitted', () => {
    const state = startCampaign(catalog, 'border_dispute', 'salvaged-hull-rebuild');
    const mech = recoveredHulk(catalog, fieldHull(), 'mech-salvage', state.day);
    if (mech === null) throw new Error('the salvage design is missing');
    state.mechs.push(mech);

    const pilot = state.pilots[0];
    if (pilot === undefined) throw new Error('the campaign has no pilot');
    assign(state, pilot.id, mech.id);
    const quote = estimateRepair(catalog, mech);
    expect(quote.cost).toBeGreaterThan(mech.rebuildCost);
    expect(quote.days).toBeGreaterThan(catalog.rules.salvage.hulkRebuildDays);
    state.cbills = Math.max(state.cbills, quote.cost);

    expect(rebuildHulk(catalog, state, mech).ok).toBe(true);
    expect(state.cbills).toBeGreaterThanOrEqual(0);
    advanceDays(catalog, state, quote.days);
    expect(mech).toMatchObject({ status: 'ready', rebuildCost: 0 });
    expect(mech.design.mounts).toEqual([]);
    expect(deployableLance(state).some((pair) => pair.mech.id === mech.id)).toBe(false);
    expect(deserialiseCampaign(serialiseCampaign(state), catalog).state).not.toBeNull();

    addToStore(state, 'weapon', 'medium_laser');
    expect(fitFromStore(catalog, state, mech, 'medium_laser').ok).toBe(true);
    expect(deployableLance(state).some((pair) => pair.mech.id === mech.id)).toBe(true);
    expect(deserialiseCampaign(serialiseCampaign(state), catalog).state).not.toBeNull();
  });
});
