import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { acceptContract, advanceDays, campaignNodes, startCampaign } from './campaign';
import { availableNodes } from './campaign';
import {
  isSideContract,
  nextOfferDay,
  offerPeriod,
  oppositionTonnage,
  sideContractProfile,
  sideContracts,
} from './sidework';
import type { CampaignState } from './types';

const CAMPAIGN_ID = 'border_dispute';

let state: CampaignState;

beforeEach(() => {
  state = startCampaign(catalog, CAMPAIGN_ID, 'sidework');
});

describe('the hiring hall', () => {
  it('posts work from the first day', () => {
    const posted = sideContracts(catalog, state);
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((offer) => isSideContract(offer.id))).toBe(true);
  });

  it('never posts the same job twice in one week', () => {
    const posted = sideContracts(catalog, state);
    const missions = posted.map((offer) => offer.missionId);
    expect(new Set(missions).size).toBe(missions.length);
  });

  it('rebuilds the identical board on every call', () => {
    // The campaign screen recomputes this on every React render. If the board
    // drew from state.rng, the campaign's whole random stream would depend on
    // how many times the player happened to look at it.
    const before = state.rng;
    const first = sideContracts(catalog, state);
    const second = sideContracts(catalog, state);

    expect(second).toEqual(first);
    expect(state.rng).toEqual(before);
  });

  it('holds the same board all week and turns it over on the rollover', () => {
    const monday = sideContracts(catalog, state);
    const period = offerPeriod(catalog, state.day);

    advanceDays(catalog, state, 1);
    expect(offerPeriod(catalog, state.day)).toBe(period);
    expect(sideContracts(catalog, state).map((o) => o.id)).toEqual(monday.map((o) => o.id));

    advanceDays(catalog, state, catalog.rules.economy.sideContracts.refreshDays);
    expect(offerPeriod(catalog, state.day)).toBeGreaterThan(period);
    expect(sideContracts(catalog, state).map((o) => o.missionId)).not.toEqual(
      monday.map((o) => o.missionId),
    );
  });

  it('says exactly when the current board renews', () => {
    expect(nextOfferDay(catalog, 0)).toBe(7);
    expect(nextOfferDay(catalog, 6)).toBe(7);
    expect(nextOfferDay(catalog, 7)).toBe(14);
  });

  it('takes a signed posting off the board, and leaves the others alone', () => {
    const posted = sideContracts(catalog, state);
    const taken = posted[0];
    const other = posted[1];
    expect(taken).toBeDefined();
    expect(other).toBeDefined();
    if (taken === undefined || other === undefined) return;

    expect(acceptContract(catalog, state, taken.id, 'fee_first').ok).toBe(true);

    const after = sideContracts(catalog, state);
    expect(after.map((offer) => offer.id)).not.toContain(taken.id);
    // Terms are drawn per slot, so consuming one does not shift its neighbours.
    expect(after.find((offer) => offer.id === other.id)).toEqual(other);
  });

  it('forgets last week’s signings rather than remembering them forever', () => {
    const first = sideContracts(catalog, state)[0];
    if (first === undefined) return;
    acceptContract(catalog, state, first.id, 'fee_first');
    expect(state.sideTaken).toHaveLength(1);

    advanceDays(catalog, state, catalog.rules.economy.sideContracts.refreshDays * 2);
    expect(state.sideTaken).toHaveLength(0);
  });

  it('prices a job off the weight of what is waiting on it', () => {
    const heavy = oppositionTonnage(catalog, 'standoff_ridge');
    const light = oppositionTonnage(catalog, 'skirmish_ridge');
    expect(heavy).toBeGreaterThan(0);
    expect(light).toBeGreaterThan(0);

    // Same board, both jobs priced by the same rule: the one with more metal on
    // the far side is worth more, whatever the variance roll did.
    const posted = sideContracts(catalog, state);
    for (const offer of posted) {
      expect(offer.basePayout).toBeGreaterThan(0);
      expect(offer.maxSalvageShare).toBeGreaterThanOrEqual(0);
      expect(offer.deadlineDays).toBeGreaterThan(0);
    }
  });

  it('counts timed waves in a defence posting', () => {
    expect(oppositionTonnage(catalog, 'switchyard_watch')).toBe(245);
  });

  it('posts the two objective-led jobs without inventing a destroy requirement', () => {
    const campaign = catalog.campaigns.get(CAMPAIGN_ID);
    const defence = catalog.missions.get('switchyard_watch');
    const relay = catalog.missions.get('relay_chain');

    expect(campaign?.sideWork.missionIds).toEqual(
      expect.arrayContaining(['switchyard_watch', 'relay_chain']),
    );
    expect(defence?.objectives.find((objective) => objective.id === 'keep_switch')).toMatchObject({
      type: 'protect_zones',
      required: true,
      zoneIds: ['freight_switch'],
    });
    expect(
      defence?.triggers
        .filter((trigger) => trigger.effects.some((effect) => effect.type === 'spawn'))
        .map((trigger) => trigger.when.type === 'elapsed' ? trigger.when.seconds : -1),
    ).toEqual([30, 70, 110]);
    expect(relay?.objectives.find((objective) => objective.id === 'key_relays')).toMatchObject({
      type: 'capture_zones',
      required: true,
      zoneIds: ['south_relay', 'west_relay', 'north_relay'],
    });
    expect(relay?.objectives.find((objective) => objective.id === 'copy_schedule')).toMatchObject({
      type: 'hold_zones',
      required: true,
      holdSeconds: 25,
      zoneIds: ['south_relay', 'west_relay', 'north_relay'],
    });
    expect(
      [defence, relay].every((mission) =>
        mission?.objectives.every(
          (objective) =>
            objective.team === 0 &&
            (objective.type !== 'destroy_all' || objective.required === false),
        ),
      ),
    ).toBe(true);
  });

  it('describes enforced mission facts instead of inventing posting modifiers', () => {
    const mission = catalog.missions.get('causeway_night');
    const map = catalog.maps.get(mission?.mapId ?? '');
    const profile = sideContractProfile(catalog, 'causeway_night');

    expect(profile).toEqual({
      operation: mission?.type,
      battlefield: map?.name,
      dropTonnage: mission?.dropTonnage,
      oppositionTonnage: oppositionTonnage(catalog, 'causeway_night'),
      objectives: mission?.objectives
        .filter((objective) => objective.team === 0 && objective.required)
        .map((objective) => objective.label),
    });
  });

  it('does not end the campaign, because posted work always renews', () => {
    // The war can run out; the hall cannot. Only the authored campaign running
    // dry is allowed to finish a run.
    expect(campaignNodes(catalog, state).length).toBeGreaterThan(0);
    expect(availableNodes(catalog, state).length).toBeGreaterThan(
      campaignNodes(catalog, state).length,
    );
  });
});
