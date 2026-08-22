import { describe, expect, it } from 'vitest';
import { catalog, spawnDesign, testWorld } from '../../tests/support';
import { roleOf, type CombatRole } from '../sim/ai/roles';
import { computeHeatProfile, computeLoadout } from '../sim/loadout';

const NEW_STOCK = ['votive_picket', 'obsequy_vigil', 'pallvault_procession'] as const;

function designOf(id: (typeof NEW_STOCK)[number]) {
  const design = catalog.designs.get(id);
  if (design === undefined) throw new Error(`missing stock design ${id}`);
  return design;
}

describe('Phase 3 Aurelian stock', () => {
  it('ships legal builds at their stated tonnage', () => {
    for (const id of NEW_STOCK) {
      const loadout = computeLoadout(catalog, designOf(id));
      expect(loadout.valid, `${id}: ${loadout.issues.map((issue) => issue.message).join('; ')}`)
        .toBe(true);
      expect(loadout.freeTonnage, id).toBeCloseTo(0, 6);
    }
  });

  it('ships native batteries without ammunition', () => {
    for (const id of NEW_STOCK) {
      const design = designOf(id);
      expect(design.ammo, id).toEqual([]);
      for (const mount of design.mounts) {
        expect(catalog.weapons.get(mount.weaponId)?.faction, `${id}.${mount.weaponId}`)
          .toBe('aurelian');
      }
    }
  });

  it('fills three different tactical jobs', () => {
    const world = testWorld('phase3-roles');
    const roles = new Map<(typeof NEW_STOCK)[number], CombatRole>([
      ['votive_picket', 'scout'],
      ['obsequy_vigil', 'sniper'],
      ['pallvault_procession', 'skirmisher'],
    ]);
    for (const [id, expected] of roles) {
      expect(roleOf(world, spawnDesign(world, id)).role, id).toBe(expected);
    }
  });

  it('makes the light hunter pay heat for its firepower', () => {
    const profile = computeHeatProfile(catalog, designOf('votive_picket'));
    expect(profile.alphaSafe).toBe(true);
    expect(profile.netHeatPerSecond).toBeGreaterThan(0);
    expect(profile.secondsToShutdownRisk).not.toBeNull();
  });

  it('makes the Pallvault trade sustained fire for speed', () => {
    const design = designOf('pallvault_procession');
    const chassis = catalog.chassis.get(design.chassisId);
    const battery = design.mounts.reduce<Record<string, number>>(
      (counts, mount) => ({ ...counts, [mount.weaponId]: (counts[mount.weaponId] ?? 0) + 1 }),
      {},
    );
    const heat = computeHeatProfile(catalog, design);
    expect(battery).toEqual({ large_pulse_laser: 2, medium_pulse_laser: 2 });
    expect(chassis?.engineRating).toBeGreaterThan(380);
    expect(heat.alphaSafe).toBe(false);
    expect(heat.netHeatPerSecond).toBeGreaterThan(0);
  });
});
