import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import {
  abandonContract,
  acceptContract,
  advanceDays,
  deployableLance,
  startCampaign,
} from './campaign';
import { buyMech, marketListings, saleValueOf, sellMech } from './market';
import { rebuildHulk } from './refit';
import { assign, availableHires, hireCost, hirePilot } from './roster';
import { deserialiseCampaign, serialiseCampaign } from './save';
import { assessSolvency, retireCompany } from './solvency';
import type { CampaignState } from './types';

function campaign(seed = 'solvency'): CampaignState {
  return startCampaign(catalog, 'border_dispute', seed);
}

function imported(state: CampaignState): CampaignState {
  const restored = deserialiseCampaign(serialiseCampaign(state)).state;
  if (restored === null) throw new Error('campaign save did not load');
  return restored;
}

describe('company solvency', () => {
  it('does not mistake debt for defeat while a lance can work', () => {
    const state = campaign();
    state.cbills = -10_000_000;

    expect(assessSolvency(catalog, state)).toMatchObject({
      state: 'fieldable',
      action: 'none',
    });
    expect(retireCompany(catalog, state)).toEqual({
      ok: false,
      reason: 'the company still has a recovery path',
    });
  });

  it('names time, the bench and a bad seat assignment as temporary', () => {
    const waiting = campaign();
    for (const pilot of waiting.pilots) pilot.injuredUntilDay = waiting.day + 6;
    expect(assessSolvency(catalog, waiting)).toMatchObject({
      state: 'temporary', action: 'wait', recoverOnDay: waiting.day + 6,
    });
    advanceDays(catalog, waiting, 6);
    expect(assessSolvency(catalog, waiting).state).toBe('fieldable');

    const held = campaign();
    held.benched = held.pilots.map((pilot) => pilot.id);
    expect(assessSolvency(catalog, held).action).toBe('call_up');

    const misassigned = campaign();
    const wreck = misassigned.mechs[0];
    if (wreck === undefined) throw new Error('campaign has no mech');
    wreck.status = 'hulk';
    for (const pilot of misassigned.pilots) pilot.mechId = wreck.id;
    expect(deployableLance(misassigned)).toEqual([]);
    expect(assessSolvency(catalog, misassigned).action).toBe('reassign');
  });

  it('recognises an affordable rebuild and hire without inventing aid', () => {
    const wrecked = campaign();
    for (const mech of wrecked.mechs) {
      mech.status = 'hulk';
      mech.rebuildCost = 125_000;
    }
    wrecked.cbills = 125_000;
    expect(assessSolvency(catalog, wrecked)).toMatchObject({
      state: 'fundable',
      plan: { pilotName: null, mechCost: 125_000, mechNeedsRebuild: true },
    });

    const uncrewed = campaign();
    for (const pilot of uncrewed.pilots) pilot.dead = true;
    uncrewed.cbills = 10_000_000;
    const report = assessSolvency(catalog, uncrewed);
    expect(report).toMatchObject({
      state: 'fundable',
      plan: { mechCost: 0, mechNeedsRebuild: false },
    });
    expect(report.plan?.pilotName).not.toBeNull();
  });

  it('loads a zero-mech import and uses only the yard that is actually posted', () => {
    const state = campaign('zero-mech');
    state.mechs = [];
    state.cbills = 100_000_000;
    const restored = imported(state);
    const listing = marketListings(catalog, restored).sort((a, b) => a.price - b.price)[0];
    if (listing === undefined) throw new Error('yard has no listing');

    const report = assessSolvency(catalog, restored);
    expect(report).toMatchObject({
      state: 'fundable',
      plan: { mechName: listing.design.name, mechSource: 'yard', mechCost: listing.price },
    });
    expect(buyMech(catalog, restored, listing.id).ok).toBe(true);
    const pilot = restored.pilots[0];
    const mech = restored.mechs[0];
    if (pilot === undefined || mech === undefined) throw new Error('yard recovery is incomplete');
    assign(restored, pilot.id, mech.id);
    expect(assessSolvency(catalog, restored).state).toBe('fieldable');
  });

  it('waits for affordable fresh stock instead of declaring a sold-out yard terminal', () => {
    const state = campaign('future-yard');
    state.mechs = [];
    state.cbills = 100_000_000;
    state.marketBought = marketListings(catalog, state).map((listing) => listing.id);

    expect(marketListings(catalog, state)).toEqual([]);
    expect(assessSolvency(catalog, state)).toMatchObject({
      state: 'temporary', action: 'wait_yard', recoverOnDay: expect.any(Number),
    });

    expect(acceptContract(catalog, state, 'militia_raid', 'standard').ok).toBe(true);
    expect(assessSolvency(catalog, state)).toMatchObject({
      state: 'temporary', action: 'wait_yard', recoverOnDay: expect.any(Number),
    });
  });

  it('loads a zero-pilot import and points to an existing hire', () => {
    const state = campaign('zero-pilot');
    state.pilots = [];
    state.cbills = 10_000_000;
    const restored = imported(state);
    const hire = availableHires(catalog, restored)[0];
    if (hire === undefined) throw new Error('register is empty');

    expect(assessSolvency(catalog, restored)).toMatchObject({
      state: 'fundable',
      plan: { pilotName: hire.name, mechSource: 'owned' },
    });
    expect(hirePilot(catalog, restored, hire.id).ok).toBe(true);
    expect(assessSolvency(catalog, restored).state).toBe('fieldable');
  });

  it('can buy before selling the retained wreck to fund a pilot', () => {
    const state = campaign('yard-then-hire');
    state.pilots = [];
    const listing = marketListings(catalog, state).sort((a, b) => a.price - b.price)[0];
    const hire = availableHires(catalog, state)[0];
    const wreck = [...state.mechs].sort(
      (left, right) => saleValueOf(catalog, right) - saleValueOf(catalog, left),
    )[0];
    if (listing === undefined || hire === undefined || wreck === undefined) {
      throw new Error('recovery stock is incomplete');
    }
    const fullSale = saleValueOf(catalog, wreck);
    const pilotCost = hireCost(catalog, hire);
    if (fullSale <= listing.price || fullSale <= pilotCost) {
      throw new Error('recovery stock does not exercise the purchase sequence');
    }
    wreck.status = 'hulk';
    wreck.rebuildCost = fullSale - pilotCost;
    state.mechs = [wreck];
    state.cbills = listing.price;

    const restored = imported(state);
    const report = assessSolvency(catalog, restored);
    expect(report).toMatchObject({
      state: 'fundable',
      plan: {
        mechSource: 'yard',
        saleBeforePurchase: 0,
        saleAfterPurchase: pilotCost,
      },
    });
    expect(buyMech(catalog, restored, listing.id).ok).toBe(true);
    expect(sellMech(catalog, restored, wreck.id).ok).toBe(true);
    expect(hirePilot(catalog, restored, hire.id).ok).toBe(true);
    expect(assessSolvency(catalog, restored).state).toBe('fieldable');
  });

  it('counts a posted yard replacement when rebuilding the last wreck costs more', () => {
    const state = campaign('yard-instead-of-rebuild');
    const wreck = state.mechs[0];
    if (wreck === undefined) throw new Error('campaign has no mech');
    state.mechs = [wreck];
    wreck.status = 'hulk';
    const listing = marketListings(catalog, state).sort((a, b) => a.price - b.price)[0];
    if (listing === undefined) throw new Error('yard has no listing');
    wreck.rebuildCost = listing.price + 1;
    state.cbills = listing.price;

    expect(assessSolvency(catalog, state)).toMatchObject({
      state: 'fundable',
      plan: { mechName: listing.design.name, mechSource: 'yard', needsSale: false },
    });
  });

  it('requires contract withdrawal before confirmed retirement', () => {
    const state = campaign('retirement');
    expect(acceptContract(catalog, state, 'militia_raid', 'standard').ok).toBe(true);
    const last = state.mechs[0];
    if (last === undefined) throw new Error('campaign has no mech');
    state.mechs = [last];
    last.status = 'hulk';
    last.rebuildCost = 500_000;
    state.cbills = -1;

    expect(assessSolvency(catalog, state)).toMatchObject({
      state: 'terminal', block: 'insufficient_funds',
    });
    expect(retireCompany(catalog, state)).toEqual({
      ok: false,
      reason: 'withdraw from the active contract before retiring',
    });

    const beforeWithdrawal = state.cbills;
    abandonContract(catalog, state);
    expect(state.contract).toBeNull();
    expect(state.cbills).toBeLessThan(beforeWithdrawal);
    expect(retireCompany(catalog, state)).toEqual({ ok: true, reason: null });
    expect(state).toMatchObject({ finished: true, won: false });
    expect(state.log[0]?.text).toMatch(/retired/i);
  });

  it('requires withdrawal before a deadline-crossing wait or sale-funded recovery', () => {
    const waiting = campaign('contract-wait');
    expect(acceptContract(catalog, waiting, 'militia_raid', 'standard').ok).toBe(true);
    if (waiting.contract === null) throw new Error('contract was not signed');
    waiting.contract.deadlineDay = waiting.day + 1;
    for (const pilot of waiting.pilots) pilot.injuredUntilDay = waiting.day + 4;
    expect(assessSolvency(catalog, waiting)).toMatchObject({
      state: 'temporary', action: 'withdraw', recoverOnDay: waiting.day + 4,
    });

    const financed = campaign('contract-sales');
    expect(acceptContract(catalog, financed, 'militia_raid', 'standard').ok).toBe(true);
    for (const mech of financed.mechs) {
      mech.status = 'hulk';
      mech.rebuildCost = 100_000;
    }
    financed.cbills = 0;
    expect(assessSolvency(catalog, financed)).toMatchObject({
      state: 'temporary', action: 'withdraw', plan: { needsSale: true },
    });
  });

  it('does not promise a pilot after the register is exhausted', () => {
    const state = campaign('no-register');
    const sample = state.pilots[0];
    if (sample === undefined) throw new Error('campaign has no pilot');
    state.pilots = [...catalog.pilots.values()].map((pilot, index) => ({
      ...sample,
      id: `buried-${index}`,
      templateId: pilot.id,
      name: pilot.name,
      dead: true,
      mechId: null,
    }));

    expect(assessSolvency(catalog, imported(state))).toMatchObject({
      state: 'terminal', block: 'no_pilot', plan: null,
    });
  });

  it('can enact the rebuild plan it reports', () => {
    const state = campaign('rebuild-plan');
    const mech = state.mechs[0];
    if (mech === undefined) throw new Error('campaign has no mech');
    state.mechs = [mech];
    mech.status = 'hulk';
    mech.rebuildCost = 100_000;
    state.cbills = 100_000;

    expect(assessSolvency(catalog, state).state).toBe('fundable');
    expect(rebuildHulk(catalog, state, mech).ok).toBe(true);
    advanceDays(catalog, state, catalog.rules.salvage.hulkRebuildDays);
    expect(assessSolvency(catalog, state).state).toBe('fieldable');
  });
});
