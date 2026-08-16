import { describe, expect, it } from 'vitest';
import { rechooseSalvage, SALVAGE_PICKS, type SalvageReport } from './salvage';
import { addToStore, type CampaignState, type StoreItem } from './types';

function stubState(): CampaignState {
  return { store: [] } as unknown as CampaignState;
}

function offer(...ids: string[]): StoreItem[] {
  return ids.map((itemId) => ({ kind: 'weapon' as const, itemId, count: 1 }));
}

function report(taken: StoreItem[], offered: StoreItem[]): SalvageReport {
  return { candidates: [], chassisRecovered: [], offered, items: taken };
}

const countOf = (state: CampaignState, itemId: string): number =>
  state.store.find((item) => item.itemId === itemId)?.count ?? 0;

describe('choosing what comes home', () => {
  it('swaps the take for a different pick out of the same offer', () => {
    const state = stubState();
    const offered = offer('medium_laser', 'ac10', 'srm6', 'ppc', 'lrm15');
    const taken = offer('medium_laser', 'ac10');
    for (const item of taken) addToStore(state, item.kind, item.itemId, item.count);

    rechooseSalvage(state, report(taken, offered), offer('ppc', 'srm6'));

    expect(countOf(state, 'ppc')).toBe(1);
    expect(countOf(state, 'srm6')).toBe(1);
    expect(countOf(state, 'medium_laser')).toBe(0);
    expect(countOf(state, 'ac10')).toBe(0);
  });

  it('keeps an overlapping pick without double-counting it', () => {
    const state = stubState();
    const offered = offer('medium_laser', 'ac10', 'ppc');
    const taken = offer('medium_laser', 'ac10');
    for (const item of taken) addToStore(state, item.kind, item.itemId, item.count);

    rechooseSalvage(state, report(taken, offered), offer('medium_laser', 'ppc'));

    expect(countOf(state, 'medium_laser')).toBe(1);
    expect(countOf(state, 'ppc')).toBe(1);
    expect(countOf(state, 'ac10')).toBe(0);
  });

  it('refuses anything that was not on the offer, and never overfills the hold', () => {
    const state = stubState();
    const offered = offer('medium_laser', 'ac10', 'ppc');
    const record = report([], offered);

    const picked = rechooseSalvage(state, record, [
      ...offer('gauss_rifle'),
      ...offer('medium_laser', 'ac10', 'ppc'),
    ]);

    expect(picked).toHaveLength(SALVAGE_PICKS);
    expect(countOf(state, 'gauss_rifle')).toBe(0);
  });
});
