import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { Design } from '../../schema/design';
import { DesignSchema } from '../../schema/design';
import {
  designIssues,
  idFromName,
  InvalidBuildError,
  listStoredDesigns,
  loadFromStorage,
  saveToStorage,
  setName,
} from './editor';

function stock(id: string): Design {
  const design = catalog.designs.get(id);
  if (design === undefined) throw new Error(`no design ${id}`);
  return JSON.parse(JSON.stringify(design)) as Design;
}

describe('naming a design', () => {
  it('gives the design an id of its own so variants do not collide', () => {
    const base = stock('sentinel_brawler');
    const sniper = setName(base, "Sentinel 'Sniper'");
    const skirmisher = setName(base, "Sentinel 'Skirmisher'");

    expect(sniper.id).not.toBe(base.id);
    expect(sniper.id).not.toBe(skirmisher.id);
  });

  it('always produces an id the schema will load back', () => {
    for (const name of ["Sentinel 'Sniper'", '  spaced  out  ', '2nd Pattern', '???']) {
      const renamed = setName(stock('sentinel_brawler'), name);
      expect(DesignSchema.safeParse(renamed).success, `${name} → ${renamed.id}`).toBe(true);
    }
  });

  it('leaves the rest of the build alone', () => {
    const base = stock('sentinel_brawler');
    const renamed = setName(base, 'Something Else');
    expect(renamed.mounts).toEqual(base.mounts);
    expect(renamed.armour).toEqual(base.armour);
  });

  it('falls back to a stem when the name has nothing usable in it', () => {
    expect(idFromName('!!!')).toBe('custom_design');
    expect(idFromName('7')).toBe('custom_design');
  });
});

describe('saving to storage', () => {
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

  it('keeps two renamed variants of the same stock design side by side', () => {
    const base = stock('sentinel_brawler');
    saveToStorage(catalog, setName(base, "Sentinel 'Sniper'"));
    saveToStorage(catalog, setName(base, "Sentinel 'Skirmisher'"));

    expect(listStoredDesigns()).toHaveLength(2);
    expect(loadFromStorage(idFromName("Sentinel 'Sniper'")).design?.name).toBe("Sentinel 'Sniper'");
  });

  it('says so when a save lands on a name already in use', () => {
    const design = setName(stock('sentinel_brawler'), "Sentinel 'Sniper'");
    expect(saveToStorage(catalog, design).replaced).toBe(false);
    expect(saveToStorage(catalog, design).replaced).toBe(true);
  });

  it('refuses a build the schema will not load back, not just an illegal loadout', () => {
    // A blank name passes every loadout rule and then writes a file that
    // DesignSchema rejects — the save was gone the moment it was made.
    const blank = setName(stock('sentinel_brawler'), '');
    expect(designIssues(catalog, blank).length).toBeGreaterThan(0);
    expect(() => saveToStorage(catalog, blank)).toThrow(InvalidBuildError);
    expect(listStoredDesigns()).toHaveLength(0);
  });
});
