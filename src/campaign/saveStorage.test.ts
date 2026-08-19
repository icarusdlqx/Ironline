import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import { startCampaign } from './campaign';
import {
  campaignPersistenceStatus,
  clearSavedCampaign,
  loadCampaign,
  rawCampaignBlob,
  saveCampaign,
} from './save';

const CAMPAIGN_KEY = 'ironline.campaign';
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

let values: Map<string, string>;

function installStorage(overrides: Partial<Storage> = {}): Storage {
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    ...overrides,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

describe.sequential('campaign storage recovery', () => {
  beforeEach(() => {
    values = new Map();
    installStorage();
    clearSavedCampaign({ recover: true });
    loadCampaign();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalStorage === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', originalStorage);
  });

  it('distinguishes a missing campaign from malformed JSON', async () => {
    expect(loadCampaign()).toMatchObject({ state: null, source: 'missing', raw: null });

    const damaged = '{"version":1,"state":';
    values.set(CAMPAIGN_KEY, damaged);
    const loaded = loadCampaign();

    expect(loaded).toMatchObject({ state: null, source: 'invalid', raw: damaged });
    expect(loaded.error).toMatch(/not valid JSON/);
    expect(loaded.persistence).toMatchObject({
      mode: 'memory-only',
      issue: 'invalid-save',
      recoveryRaw: damaged,
    });
    expect(await rawCampaignBlob(loaded.raw ?? '').text()).toBe(damaged);
  });

  it('retains schema-invalid data and blocks ordinary transactions', () => {
    const damaged = JSON.stringify({ version: 1, state: { campaignId: 'border_dispute' } });
    values.set(CAMPAIGN_KEY, damaged);
    expect(loadCampaign()).toMatchObject({ source: 'invalid', raw: damaged });

    const state = startCampaign(catalog, 'border_dispute', 'recovery-lock');
    state.cbills -= 250;
    const saved = saveCampaign(state);

    expect(saved).toMatchObject({ ok: false, error: 'campaign storage is locked for recovery' });
    expect(values.get(CAMPAIGN_KEY)).toBe(damaged);
  });

  it('replaces damaged data only through an explicit recovery action', () => {
    values.set(CAMPAIGN_KEY, '{bad');
    loadCampaign();
    const state = startCampaign(catalog, 'border_dispute', 'recovered');

    expect(saveCampaign(state, { recover: true }).ok).toBe(true);
    expect(values.get(CAMPAIGN_KEY)).not.toBe('{bad');
    expect(loadCampaign()).toMatchObject({ source: 'loaded', state: { seed: 'recovered' } });
    expect(campaignPersistenceStatus()).toMatchObject({ mode: 'persistent', issue: null });
  });

  it('survives security errors while reading storage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('access denied', 'SecurityError');
      },
    });

    expect(() => loadCampaign()).not.toThrow();
    expect(loadCampaign()).toMatchObject({
      source: 'unavailable',
      persistence: { mode: 'memory-only', issue: 'storage-unavailable' },
    });
  });

  it('keeps recoverable bytes after storage becomes inaccessible', () => {
    const damaged = '{bad';
    values.set(CAMPAIGN_KEY, damaged);
    loadCampaign();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('access denied', 'SecurityError');
      },
    });

    expect(loadCampaign()).toMatchObject({
      source: 'unavailable',
      persistence: { recoveryRaw: damaged },
    });
  });

  it('enters memory-only mode after quota failure and stops retrying transactions', () => {
    const setItem = vi.fn(() => {
      throw new DOMException('quota reached', 'QuotaExceededError');
    });
    installStorage({ setItem });
    loadCampaign();
    const state = startCampaign(catalog, 'border_dispute', 'quota');

    expect(saveCampaign(state)).toMatchObject({
      ok: false,
      status: { mode: 'memory-only', issue: 'write-failed' },
    });
    expect(loadCampaign()).toMatchObject({
      source: 'memory',
      state: { seed: 'quota' },
      persistence: { mode: 'memory-only', issue: 'write-failed' },
    });
    expect(loadCampaign(catalog, { storedOnly: true })).toMatchObject({
      source: 'missing',
      persistence: { mode: 'memory-only', issue: 'write-failed' },
    });
    expect(saveCampaign(state).error).toBe('campaign storage is locked for recovery');
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('guards failed removals without changing any storage key', () => {
    values.set(CAMPAIGN_KEY, 'kept');
    const removeItem = vi.fn(() => {
      throw new DOMException('access denied', 'SecurityError');
    });
    installStorage({ removeItem });
    loadCampaign();

    expect(clearSavedCampaign({ recover: true })).toMatchObject({
      ok: false,
      status: { mode: 'memory-only', issue: 'remove-failed' },
    });
    expect(values.get(CAMPAIGN_KEY)).toBe('kept');
  });

  it('continues to write and load ordinary campaigns', () => {
    const state = startCampaign(catalog, 'border_dispute', 'ordinary');
    expect(saveCampaign(state).ok).toBe(true);
    expect([...values.keys()]).toEqual([CAMPAIGN_KEY]);
    expect(loadCampaign()).toMatchObject({
      source: 'loaded',
      error: null,
      state: { seed: 'ordinary' },
      persistence: { mode: 'persistent', issue: null },
    });
  });
});
