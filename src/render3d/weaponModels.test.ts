import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import type { Weapon } from '../schema/weapon';
import { disposeObjectResources } from './sceneResources';
import type { MountArt } from './weaponModelTypes';
import { buildWeaponModel, weaponModelFamily } from './weaponModels';

function mount(weapon: Weapon): MountArt {
  return {
    weaponId: weapon.id,
    location: 'left_arm',
    type: weapon.type,
    tonnage: weapon.tonnage,
    projectiles: weapon.projectiles,
    recoil: weapon.recoil,
    visual: weapon.visual,
  };
}

function topology(root: Group): { draws: number; triangles: number; names: string } {
  let draws = 0;
  let triangles = 0;
  const names: string[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    draws += 1;
    names.push(node.name);
    const base = node.geometry.index === null
      ? node.geometry.getAttribute('position').count / 3
      : node.geometry.index.count / 3;
    triangles += base * (node instanceof InstancedMesh ? node.count : 1);
  });
  return { draws, triangles, names: names.sort().join('|') };
}

function expectFinite(root: Group): void {
  root.traverse((node) => {
    expect([...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()]
      .every(Number.isFinite)).toBe(true);
    if (!(node instanceof Mesh)) return;
    const positions = node.geometry.getAttribute('position');
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  });
}

describe('weapon model catalogue', () => {
  it('builds every current weapon within both geometry budgets', () => {
    for (const weapon of catalog.weapons.values()) {
      const tactical = buildWeaponModel(
        mount(weapon),
        1,
        14,
        new MeshStandardMaterial(),
        new MeshStandardMaterial(),
      );
      const hero = buildWeaponModel(
        mount(weapon),
        1,
        14,
        new MeshStandardMaterial(),
        new MeshStandardMaterial(),
        'hero',
      );
      const tacticalCost = topology(tactical.root);
      const heroCost = topology(hero.root);

      expect(tacticalCost.draws, weapon.id).toBeLessThanOrEqual(4);
      expect(tacticalCost.triangles, weapon.id).toBeLessThanOrEqual(900);
      expect(heroCost.draws, weapon.id).toBeLessThanOrEqual(7);
      expect(heroCost.triangles, weapon.id).toBeLessThanOrEqual(2_400);
      expect(tactical.rig.muzzle.position.x, weapon.id)
        .toBeGreaterThan(tactical.rig.breech.position.x);
      expect(tactical.root.userData.weaponFamily, weapon.id).toBe(weaponModelFamily(mount(weapon)));
      expect(tactical.root.userData.nativeFaction, weapon.id).toBe(weapon.faction);
      expect(tactical.root.userData.geometryQuality, weapon.id).toBe('tactical');
      expect(hero.root.userData.geometryQuality, weapon.id).toBe('hero');
      expectFinite(tactical.root);
      expectFinite(hero.root);
      disposeObjectResources(tactical.root);
      disposeObjectResources(hero.root);
    }
  });

  it('gives every active family a different visible construction signature', () => {
    const representatives = [
      'medium_laser',
      'medium_pulse_laser',
      'ppc',
      'flamer',
      'ac5',
      'machine_gun',
      'lbx_ac10',
      'gauss_rifle',
      'srm6',
      'lrm10',
      'streak_srm6',
    ];
    const signatures = new Set<string>();
    for (const id of representatives) {
      const weapon = catalog.weapons.get(id);
      expect(weapon).toBeDefined();
      if (weapon === undefined) continue;
      const built = buildWeaponModel(
        mount(weapon),
        1,
        14,
        new MeshStandardMaterial(),
        new MeshStandardMaterial(),
      );
      signatures.add(topology(built.root).names);
      const prefix = weapon.faction === 'aurelian' ? 'aurelian-' : 'line-';
      expect(topology(built.root).names, id).toContain(prefix);
      disposeObjectResources(built.root);
    }
    expect(signatures).toHaveLength(representatives.length);
  });

  it('keeps a large rack in one bounded tube batch', () => {
    const weapon = catalog.weapons.get('lrm20');
    expect(weapon).toBeDefined();
    if (weapon === undefined) return;
    const built = buildWeaponModel(
      mount(weapon),
      1.2,
      14,
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
    );
    const batches: InstancedMesh[] = [];
    built.root.traverse((node) => {
      if (node instanceof InstancedMesh && node.name === 'missile-tubes') batches.push(node);
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.count).toBe(20);
    disposeObjectResources(built.root);
  });

  it('places production missile muzzles at or beyond the visible tube faces', () => {
    const instance = new Matrix4();
    const vertex = new Vector3();
    for (const weapon of catalog.weapons.values()) {
      if (!weaponModelFamily(mount(weapon)).startsWith('missile-')) continue;
      const built = buildWeaponModel(
        mount(weapon),
        0.5 + Math.min(1, weapon.tonnage / 14),
        14,
        new MeshStandardMaterial(),
        new MeshStandardMaterial(),
      );
      let tubeFace = Number.NEGATIVE_INFINITY;
      built.root.traverse((node) => {
        if (!(node instanceof InstancedMesh) || node.name !== 'missile-tubes') return;
        node.geometry.computeBoundingBox();
        const front = node.geometry.boundingBox?.max.y;
        if (front === undefined) return;
        for (let index = 0; index < node.count; index += 1) {
          node.getMatrixAt(index, instance);
          vertex.set(0, front, 0).applyMatrix4(instance);
          tubeFace = Math.max(tubeFace, vertex.x);
        }
      });
      expect(tubeFace, weapon.id).toBeGreaterThan(Number.NEGATIVE_INFINITY);
      expect(built.rig.muzzle.position.x, weapon.id).toBeGreaterThanOrEqual(tubeFace - 1e-6);
      disposeObjectResources(built.root);
    }
  });

  it('keeps aggregate disposal idempotent with shared mount materials', () => {
    const root = new Group();
    const sharedBore = new MeshStandardMaterial();
    for (const weapon of catalog.weapons.values()) {
      root.add(buildWeaponModel(
        mount(weapon),
        1,
        14,
        new MeshStandardMaterial(),
        sharedBore,
      ).root);
    }
    const disposals = vi.fn();
    const geometries = new Set();
    const materials = new Set();
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      if (Array.isArray(node.material)) node.material.forEach((entry) => materials.add(entry));
      else materials.add(node.material);
    });
    for (const resource of [...geometries, ...materials]) {
      (resource as { addEventListener: (type: string, listener: () => void) => void })
        .addEventListener('dispose', disposals);
    }

    disposeObjectResources(root);
    disposeObjectResources(root);

    expect(disposals).toHaveBeenCalledTimes(geometries.size + materials.size);
  });
});
