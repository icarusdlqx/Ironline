import { InstancedMesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { MountArt } from './weaponModels';
import {
  advanceWeaponRecoil,
  buildWeaponModel,
  triggerWeaponRecoil,
  weaponModelFamily,
} from './weaponModels';

function mount(overrides: Partial<MountArt> = {}): MountArt {
  return {
    weaponId: 'medium_laser',
    location: 'left_arm',
    type: 'energy',
    tonnage: 1,
    projectiles: 1,
    recoil: 0,
    visual: { style: 'beam', colour: '#7bff4f', width: 2.4, arc: 0 },
    ...overrides,
  };
}

describe('weapon construction families', () => {
  it('uses authored style and stable id refinements', () => {
    expect(weaponModelFamily(mount())).toBe('beam');
    expect(
      weaponModelFamily(mount({ weaponId: 'large_pulse_laser', visual: { style: 'pulse', colour: '#ffffff', width: 3, arc: 0 } })),
    ).toBe('pulse');
    expect(
      weaponModelFamily(mount({ weaponId: 'ppc', visual: { style: 'bolt', colour: '#ffffff', width: 4, arc: 0 } })),
    ).toBe('projector');
    expect(
      weaponModelFamily(mount({ weaponId: 'flamer', visual: { style: 'flame', colour: '#ffffff', width: 6, arc: 0 } })),
    ).toBe('flame');
    expect(weaponModelFamily(mount({ weaponId: 'ac10', type: 'ballistic' }))).toBe('cannon');
    expect(weaponModelFamily(mount({ weaponId: 'rotary_ac2', type: 'ballistic' }))).toBe('rotary-cannon');
    expect(weaponModelFamily(mount({ weaponId: 'ultra_ac5', type: 'ballistic' }))).toBe('rapid-cannon');
    expect(weaponModelFamily(mount({ weaponId: 'lbx_ac10', type: 'ballistic' }))).toBe('scatter-cannon');
    expect(
      weaponModelFamily(mount({ weaponId: 'gauss_rifle', type: 'ballistic', visual: { style: 'slug', colour: '#ffffff', width: 3, arc: 0 } })),
    ).toBe('rail');
    expect(
      weaponModelFamily(mount({ weaponId: 'lrm20', type: 'missile', projectiles: 20, visual: { style: 'missile', colour: '#ffffff', width: 2, arc: 58 } })),
    ).toBe('missile-loft');
    expect(
      weaponModelFamily(mount({ weaponId: 'streak_srm6', type: 'missile', projectiles: 6 })),
    ).toBe('missile-seeker');
    expect(
      weaponModelFamily(mount({ weaponId: 'srm6', type: 'missile', projectiles: 6 })),
    ).toBe('missile-flat');
    expect(
      weaponModelFamily(mount({ weaponId: 'thunderbolt15', type: 'missile', projectiles: 1 })),
    ).toBe('missile-heavy');
  });

  it('draws a rack of tubes as one instance batch', () => {
    const built = buildWeaponModel(
      mount({
        weaponId: 'lrm20',
        type: 'missile',
        tonnage: 10,
        projectiles: 20,
        recoil: 0.05,
        visual: { style: 'missile', colour: '#ff7d4c', width: 2, arc: 58 },
      }),
      1.2,
      14,
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
    );
    const batches: InstancedMesh[] = [];
    built.root.traverse((child) => {
      if (child instanceof InstancedMesh && child.name === 'missile-tubes') batches.push(child);
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.count).toBe(20);
    expect(built.rig.muzzle.position.x).toBeGreaterThan(0);
  });

  it('returns recoil to rest without replacing its transform', () => {
    const built = buildWeaponModel(
      mount({ weaponId: 'ac20', type: 'ballistic', recoil: 0.35 }),
      1.5,
      16,
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
    );
    const position = built.rig.slide.position;
    triggerWeaponRecoil(built.rig);
    const peak = built.rig.kick;
    expect(built.rig.slide.position.x).toBe(-built.rig.travel);
    advanceWeaponRecoil(built.rig, 1 / 30);

    expect(built.rig.slide.position).toBe(position);
    expect(built.rig.slide.position.x).toBeLessThan(0);
    expect(built.rig.kick).toBeLessThan(peak);
  });
});
