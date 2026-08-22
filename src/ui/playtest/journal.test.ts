import { describe, expect, it, vi } from 'vitest';
import { createPlaytestJournal, playtestRequested } from './journal';
import {
  MAX_PLAYTEST_BYTES,
  MAX_PLAYTEST_EVENTS,
  MAX_PLAYTEST_SECONDS,
  PLAYTEST_STORAGE_KEY,
  emptyPlaytestReport,
  type FirstRunEvent,
  type PlaytestReport,
} from './schema';

interface FakeStorage {
  storage: Storage;
  values: Map<string, string>;
}

function fakeStorage(overrides: Partial<Storage> = {}): FakeStorage {
  const values = new Map<string, string>();
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
  return { storage, values };
}

describe('the local playtest journal', () => {
  it('recognises only the explicit local-playtest query value', () => {
    expect(playtestRequested('?playtest=1')).toBe(true);
    expect(playtestRequested('?playtest=0')).toBe(false);
    expect(playtestRequested('?playtest=1&email=not-recorded')).toBe(true);
  });

  it('does not write before opt-in and records bounded, deduplicated milestones', () => {
    const store = fakeStorage();
    let now = 1_000;
    const journal = createPlaytestJournal({
      storage: () => store.storage,
      now: () => now,
    });

    expect(journal.getSnapshot().enabled).toBe(false);
    expect(journal.record({ name: 'front_door_viewed' })).toBe(false);
    expect(store.values.size).toBe(0);

    expect(journal.enable()).toBe(true);
    now = 13_700;
    expect(journal.record({ name: 'route_chosen', route: 'learn' })).toBe(true);
    expect(journal.record({ name: 'route_chosen', route: 'skirmish' })).toBe(false);

    const report = journal.getSnapshot().report;
    expect(report?.events).toEqual([
      {
        name: 'route_chosen',
        route: 'learn',
        seq: 0,
        visit: 1,
        elapsedSeconds: 10,
      },
    ]);
    expect(store.values.has(PLAYTEST_STORAGE_KEY)).toBe(true);
    expect([...store.values.keys()]).toEqual([PLAYTEST_STORAGE_KEY]);
  });

  it('stops collecting funnel events after the first ten minutes', () => {
    const store = fakeStorage();
    let now = 0;
    const journal = createPlaytestJournal({ storage: () => store.storage, now: () => now });
    journal.enable();
    now = MAX_PLAYTEST_SECONDS * 1_000;
    expect(journal.record({ name: 'training_deployed' })).toBe(true);
    now += 5_000;
    expect(journal.record({ name: 'training_selected' })).toBe(false);
    expect(journal.getSnapshot().report?.events).toHaveLength(1);
  });

  it('keeps malformed stored bytes untouched and continues in memory', () => {
    const store = fakeStorage();
    const damaged = '{"version":1,"events":';
    store.values.set(PLAYTEST_STORAGE_KEY, damaged);
    const journal = createPlaytestJournal({ storage: () => store.storage });

    expect(journal.getSnapshot()).toMatchObject({
      enabled: false,
      persistence: 'memory-only',
      issue: 'invalid-report',
    });
    expect(journal.enable()).toBe(true);
    expect(journal.record({ name: 'training_deployed' })).toBe(true);
    expect(store.values.get(PLAYTEST_STORAGE_KEY)).toBe(damaged);
    expect(journal.getSnapshot().report?.events).toHaveLength(1);
  });

  it('rejects oversized stored reports without parsing or replacing them', () => {
    const store = fakeStorage();
    const oversized = 'x'.repeat(MAX_PLAYTEST_BYTES + 1);
    store.values.set(PLAYTEST_STORAGE_KEY, oversized);

    const journal = createPlaytestJournal({ storage: () => store.storage });

    expect(journal.getSnapshot()).toMatchObject({
      enabled: false,
      persistence: 'memory-only',
      issue: 'invalid-report',
    });
    expect(store.values.get(PLAYTEST_STORAGE_KEY)).toBe(oversized);
  });

  it('survives denied reads and quota failures without losing the session copy', () => {
    const denied = createPlaytestJournal({
      storage: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(denied.enable()).toBe(true);
    expect(denied.record({ name: 'training_selected' })).toBe(true);
    expect(denied.getSnapshot()).toMatchObject({
      enabled: true,
      persistence: 'memory-only',
      issue: 'storage-unavailable',
    });

    const setItem = vi.fn(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const quota = fakeStorage({ setItem });
    const journal = createPlaytestJournal({ storage: () => quota.storage });
    expect(journal.enable()).toBe(true);
    expect(journal.record({ name: 'training_moved' })).toBe(true);
    expect(journal.getSnapshot()).toMatchObject({
      enabled: true,
      persistence: 'memory-only',
      issue: 'write-failed',
    });
    expect(journal.getSnapshot().report?.events).toHaveLength(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('increments visits for a returning opted-in report', () => {
    const store = fakeStorage();
    store.values.set(PLAYTEST_STORAGE_KEY, JSON.stringify(emptyPlaytestReport()));

    const journal = createPlaytestJournal({ storage: () => store.storage });

    expect(journal.getSnapshot().report?.visits).toBe(2);
    expect(JSON.parse(store.values.get(PLAYTEST_STORAGE_KEY) ?? '{}')).toMatchObject({
      visits: 2,
    });
  });

  it('marks a full imported report without appending a thirty-third event', () => {
    const store = fakeStorage();
    const events: FirstRunEvent[] = Array.from({ length: MAX_PLAYTEST_EVENTS }, (_, seq) => ({
      name: 'front_door_viewed',
      seq,
      visit: 1,
      elapsedSeconds: 0,
    }));
    const full: PlaytestReport = {
      ...emptyPlaytestReport(),
      nextSequence: MAX_PLAYTEST_EVENTS,
      events,
    };
    store.values.set(PLAYTEST_STORAGE_KEY, JSON.stringify(full));
    const journal = createPlaytestJournal({ storage: () => store.storage });

    expect(journal.record({ name: 'campaign_opened' })).toBe(false);
    expect(journal.getSnapshot()).toMatchObject({ issue: 'report-full' });
    expect(journal.getSnapshot().report).toMatchObject({
      truncated: true,
      events: { length: MAX_PLAYTEST_EVENTS },
    });
  });

  it('validates survey updates and exports only the strict report plus a safe note', () => {
    const store = fakeStorage();
    const journal = createPlaytestJournal({ storage: () => store.storage });
    journal.enable();
    expect(journal.updateSurvey({ clarity: 5, confusion: ['camera', 'heat'] })).toBe(true);
    expect(
      journal.updateSurvey({ clarity: 9 as never, confusion: ['camera', 'camera'] }),
    ).toBe(false);

    const exported = journal.serialiseExport(
      'Mail me@example.com at https://example.com or 123456789.',
    );
    expect(exported).not.toBeNull();
    expect(exported).not.toContain('me@example.com');
    expect(exported).not.toContain('https://example.com');
    expect(exported).not.toContain('123456789');
    expect(exported).toContain('[email removed]');
    expect(exported).toContain('[link removed]');
    expect(exported).toContain('[number removed]');
    expect(exported).not.toMatch(/battleCode|campaignSeed|userAgent|referrer|https?:\/\//u);
  });

  it('clears only its own key and reports failed deletion honestly', () => {
    const store = fakeStorage();
    store.values.set('ironline.campaign', 'kept');
    const journal = createPlaytestJournal({ storage: () => store.storage });
    journal.enable();

    expect(journal.clear()).toBe(true);
    expect(store.values.get('ironline.campaign')).toBe('kept');
    expect(store.values.has(PLAYTEST_STORAGE_KEY)).toBe(false);

    const failing = fakeStorage({
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const blocked = createPlaytestJournal({ storage: () => failing.storage });
    blocked.enable();
    expect(blocked.clear()).toBe(false);
    expect(blocked.getSnapshot()).toMatchObject({
      enabled: false,
      persistence: 'memory-only',
      issue: 'remove-failed',
    });
    expect(failing.values.has(PLAYTEST_STORAGE_KEY)).toBe(true);
  });
});
