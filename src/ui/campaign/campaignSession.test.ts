import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCampaign } from '../../campaign/campaign';
import { clearSavedCampaign, loadCampaign } from '../../campaign/save';
import { catalog } from '../../../tests/support';
import {
  debriefedCount,
  markDebriefed,
  resetDebriefed,
  revealLatestDebrief,
} from './Debrief';
import { commitCampaignChange, openCampaignSession } from './campaignSession';

describe('campaign screen persistence', () => {
  const real = globalThis.localStorage;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
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
    clearSavedCampaign({ recover: true });
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

  it('keeps a transaction in memory while an invalid campaign is held for recovery', () => {
    const damaged = '{"version":1,"state":';
    store.set('ironline.campaign', damaged);
    const onEmpty = vi.fn();
    const session = openCampaignSession(catalog, 'border_dispute', onEmpty);

    const committed = commitCampaignChange(session.state, (draft) => {
      draft.cbills -= 250;
    });

    expect(onEmpty).toHaveBeenCalledOnce();
    expect(session.persistence).toMatchObject({ mode: 'memory-only', issue: 'invalid-save' });
    expect(committed.state.cbills).toBe(session.state.cbills - 250);
    expect(committed.persistence.ok).toBe(false);
    expect(store.get('ironline.campaign')).toBe(damaged);
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

  it('keeps debrief bookkeeping secondary when browser storage is denied', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new DOMException('access denied', 'SecurityError');
        },
        setItem: () => {
          throw new DOMException('access denied', 'SecurityError');
        },
        removeItem: () => {
          throw new DOMException('access denied', 'SecurityError');
        },
      },
    });

    expect(debriefedCount()).toBe(0);
    expect(() => markDebriefed(2)).not.toThrow();
    expect(() => resetDebriefed()).not.toThrow();
  });
});
