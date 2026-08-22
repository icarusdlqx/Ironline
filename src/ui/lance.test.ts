import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { Design } from '../schema/design';
import { computeLoadout } from '../sim/loadout';
import { defaultLance, loadLance, type SkirmishBerth } from './lance';

describe('stored skirmish lance migration', () => {
  const real = globalThis.localStorage;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
  });

  it('migrates an inline custom design before validating the stored lance', () => {
    const missionId = 'training_ground';
    const lance = defaultLance(catalog, missionId);
    const first = lance[0];
    const stock = catalog.designs.get('sentinel_brawler');
    if (first === undefined || stock === undefined) throw new Error('missing lance fixture');

    const legacy = structuredClone(stock) as Design;
    const mount = legacy.mounts.find((entry) => entry.weaponId === 'ac5');
    const ammo = legacy.ammo.find((entry) => entry.weaponId === 'ac5');
    if (mount === undefined || ammo === undefined) throw new Error('missing migration fixture');
    mount.weaponId = 'light_gauss';
    ammo.weaponId = 'light_gauss';

    const stored: SkirmishBerth[] = [
      { designId: null, design: legacy, pilotId: first.pilotId },
      ...lance.slice(1),
    ];
    globalThis.localStorage.setItem(`ironline.lance.${missionId}`, JSON.stringify(stored));

    const loaded = loadLance(catalog, missionId);
    const migrated = loaded[0]?.design;
    expect(migrated?.mounts.some((entry) => entry.weaponId === 'ac5')).toBe(true);
    expect(migrated?.ammo.some((entry) => entry.weaponId === 'ac5')).toBe(true);
    expect(migrated === undefined ? null : computeLoadout(catalog, migrated).valid).toBe(true);
  });
});
