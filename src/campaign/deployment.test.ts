import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { dropTeam, dropTonnageFor, startCampaign } from './campaign';

describe('drop allowance', () => {
  it('reads the allowance the mission states', () => {
    const raid = catalog.missions.get('raid_ridge');
    expect(dropTonnageFor(catalog, 'raid_ridge')).toBe(raid?.dropTonnage);
  });

  it('falls back to the lance a mission fields when nobody stated one', () => {
    // Missions are content; one that predates the allowance must still be
    // playable, and the honest default is what it fields itself.
    const mission = catalog.missions.get('skirmish_ridge');
    if (mission === undefined) throw new Error('missing mission');
    const own = (mission.lances.find((lance) => lance.team === 0)?.units ?? []).reduce(
      (total, unit) =>
        total +
        (catalog.chassis.get(catalog.designs.get(unit.designId)?.chassisId ?? '')?.tonnage ?? 0),
      0,
    );
    const stripped = { ...mission, dropTonnage: null };
    const stubbed = {
      ...catalog,
      missions: new Map([...catalog.missions, ['skirmish_ridge', stripped]]),
    } as typeof catalog;
    expect(dropTonnageFor(stubbed, 'skirmish_ridge')).toBe(own);
  });

  it('leaves a mech behind rather than exceeding the allowance', () => {
    const state = startCampaign(catalog, 'border_dispute', 'weight');
    const heavy = state.mechs[0];
    const pilot = state.pilots[0];
    if (heavy === undefined || pilot === undefined) throw new Error('empty company');

    // One machine that eats most of the allowance on its own.
    const colossus = catalog.designs.get('colossus_siege');
    if (colossus === undefined) throw new Error('missing design');
    heavy.design = JSON.parse(JSON.stringify(colossus)) as typeof colossus;

    const team = dropTeam(catalog, state, 'raid_ridge');
    const carried = team.reduce(
      (total, pair) => total + (catalog.chassis.get(pair.mech.design.chassisId)?.tonnage ?? 0),
      0,
    );

    expect(carried).toBeLessThanOrEqual(dropTonnageFor(catalog, 'raid_ridge'));
    expect(team.length, 'the whole company still deployed').toBeLessThan(state.mechs.length);
  });
});
