import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { Design } from '../../schema/design';
import { DesignSchema } from '../../schema/design';
import {
  addAmmo,
  addMount,
  designIssues,
  fitCooling,
  idFromName,
  InvalidBuildError,
  listStoredDesigns,
  loadFromStorage,
  parseDesign,
  removeMount,
  saveToStorage,
  setName,
  spreadArmour,
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

  it('migrates retired weapon ids in imported and browser-stored builds', () => {
    const legacy = stock('sentinel_brawler');
    const mount = legacy.mounts.find((entry) => entry.weaponId === 'ac5');
    const ammo = legacy.ammo.find((entry) => entry.weaponId === 'ac5');
    if (mount === undefined || ammo === undefined) throw new Error('missing migration fixture');
    mount.weaponId = 'light_gauss';
    ammo.weaponId = 'light_gauss';

    const imported = parseDesign(JSON.stringify(legacy)).design;
    expect(imported?.mounts.some((entry) => entry.weaponId === 'ac5')).toBe(true);
    expect(imported?.ammo.some((entry) => entry.weaponId === 'ac5')).toBe(true);
    expect(imported === null ? null : designIssues(catalog, imported)).toEqual([]);

    globalThis.localStorage.setItem(`ironline.design.${legacy.id}`, JSON.stringify(legacy));
    expect(loadFromStorage(legacy.id).design).toEqual(imported);
  });
});

describe('mounting and ammunition', () => {
  it('takes the ammunition off with the last gun that fed from it', () => {
    let design = stock('sentinel_brawler');
    const mounts = design.mounts.length;
    design = addMount(design, 'machine_gun', 'left_torso');
    design = addAmmo(design, 'machine_gun', 'left_torso');

    design = removeMount(design, design.mounts.length - 1);
    expect(design.mounts).toHaveLength(mounts);
    expect(
      design.ammo.some((bin) => bin.weaponId === 'machine_gun'),
      'the bin outlived its gun',
    ).toBe(false);
  });

  it('keeps a shared bin while a second gun still feeds from it', () => {
    let design = stock('sentinel_brawler');
    design = addMount(design, 'machine_gun', 'left_torso');
    design = addMount(design, 'machine_gun', 'left_torso');
    design = addAmmo(design, 'machine_gun', 'left_torso');

    design = removeMount(design, design.mounts.length - 1);
    expect(design.ammo.some((bin) => bin.weaponId === 'machine_gun')).toBe(true);
  });
});

describe('one-click fitting', () => {
  it('spreads armour to a fraction of every location maximum', () => {
    const design = spreadArmour(catalog, stock('sentinel_brawler'), 0.5);
    const chassis = catalog.chassis.get(design.chassisId);
    if (chassis === undefined) throw new Error('no chassis');
    for (const [location, value] of Object.entries(design.armour)) {
      expect(value).toBe(Math.floor(chassis.armourMax[location as keyof typeof chassis.armourMax] * 0.5));
    }
  });

  it('sets the sinks sustained fire needs, never below the chassis floor', () => {
    const design = fitCooling(catalog, stock('sentinel_brawler'));
    const chassis = catalog.chassis.get(design.chassisId);
    if (chassis === undefined) throw new Error('no chassis');
    expect(design.heatSinks).toBeGreaterThanOrEqual(chassis.internalHeatSinks);

    // With those sinks the build is sustainable — that is the whole promise.
    let heatPerSecond = 0;
    for (const mount of design.mounts) {
      const weapon = catalog.weapons.get(mount.weaponId);
      if (weapon !== undefined) heatPerSecond += weapon.heat / weapon.cooldown;
    }
    const sink = catalog.equipment.get(design.heatSinkId);
    const perSink = (sink?.stats.dissipation ?? 1) * catalog.rules.heat.dissipationPerSinkPerSecond;
    expect(design.heatSinks * perSink).toBeGreaterThanOrEqual(heatPerSecond);
  });
});
