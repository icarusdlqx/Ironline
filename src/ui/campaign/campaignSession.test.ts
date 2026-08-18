import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startCampaign } from '../../campaign/campaign';
import { loadCampaign } from '../../campaign/save';
import { catalog } from '../../../tests/support';
import {
  debriefedCount,
  markDebriefed,
  resetDebriefed,
  revealLatestDebrief,
} from './Debrief';
import { commitCampaignChange } from './campaignSession';

describe('campaign screen persistence', () => {
  const real = globalThis.localStorage;

  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return store.size;
        },
        key: (index: number) => [...store.keys()][index] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
  });

  it('saves a completed base transaction without mutating the prior render state', () => {
    const state = startCampaign(catalog, 'border_dispute', 'autosave');
    const openingBalance = state.cbills;

    const committed = commitCampaignChange(state, (draft) => {
      draft.cbills -= 250;
      return 'Paid.';
    });

    expect(state.cbills).toBe(openingBalance);
    expect(committed.state.cbills).toBe(openingBalance - 250);
    expect(committed.message).toBe('Paid.');
    expect(loadCampaign().state?.cbills).toBe(openingBalance - 250);
  });

  it('reopens the latest restored report instead of trusting another run count', () => {
    markDebriefed(9);

    expect(revealLatestDebrief(3)).toBe(2);
    expect(debriefedCount()).toBe(2);
    expect(revealLatestDebrief(0)).toBe(0);
  });

  it('clears debrief bookkeeping for a new campaign', () => {
    markDebriefed(4);
    resetDebriefed();

    expect(debriefedCount()).toBe(0);
  });
});
