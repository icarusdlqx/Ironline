import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { testWorld, unitOf } from '../../tests/support';
import { UnitViews } from './unitViews';

describe('rendered weapon mounts', () => {
  it('cycles duplicate weapon ids through their physical muzzles', () => {
    const world = testWorld('weapon-muzzles');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const view = units.viewFor(world, entity);
    const authored = world.catalog.weapons.get('medium_laser');
    const rigs = view.model.weapons.filter((rig) => rig.weaponId === 'medium_laser');

    expect(rigs).toHaveLength(3);
    expect(rigs.every((rig) => rig.visual === authored?.visual)).toBe(true);

    units.beginFrame();
    units.markPlaced(entity.id);
    const muzzle = new Vector3();
    const origins: Vector3[] = [];
    for (let shot = 0; shot < 4; shot += 1) {
      expect(units.fireMount(entity.id, 'medium_laser', muzzle)).toBe(true);
      origins.push(muzzle.clone());
    }

    expect(origins[0]?.equals(origins[1] ?? muzzle)).toBe(false);
    expect(origins[1]?.equals(origins[2] ?? muzzle)).toBe(false);
    expect(origins[3]?.equals(origins[0] ?? muzzle)).toBe(true);
    units.dispose();
  });

  it('drives recoil from the catalogue value', () => {
    const world = testWorld('weapon-recoil');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const rig = units.viewFor(world, entity).model.weapons.find((candidate) => candidate.weaponId === 'ac5');
    expect(rig).toBeDefined();
    if (rig === undefined) return;

    units.beginFrame();
    units.markPlaced(entity.id);
    expect(units.fireMount(entity.id, 'ac5', new Vector3())).toBe(true);
    expect(rig.kick).toBe(rig.travel);
    units.beginFrame(1 / 30);
    expect(rig.slide.position.x).toBeLessThan(0);
    expect(rig.kick).toBeLessThan(rig.travel);
    units.dispose();
  });

  it('rejects hidden, unplaced and previous-frame transforms', () => {
    const world = testWorld('weapon-placement');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const view = units.viewFor(world, entity);
    const muzzle = new Vector3();

    expect(units.fireMount(entity.id, 'ac5', muzzle)).toBe(false);
    units.beginFrame();
    units.markPlaced(entity.id);
    view.model.root.visible = false;
    expect(units.fireMount(entity.id, 'ac5', muzzle)).toBe(false);
    view.model.root.visible = true;
    expect(units.fireMount(entity.id, 'ac5', muzzle)).toBe(true);
    units.beginFrame();
    expect(units.fireMount(entity.id, 'ac5', muzzle)).toBe(false);
    units.dispose();
  });
});
