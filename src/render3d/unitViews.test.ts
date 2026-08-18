import { Mesh, type Object3D, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { testWorld, unitOf } from '../../tests/support';
import { UnitViews } from './unitViews';

function meshCount(root: Object3D): number {
  let count = 0;
  root.traverse((node) => {
    if (node instanceof Mesh) count += 1;
  });
  return count;
}

describe('rendered weapon mounts', () => {
  it('rebuilds scorch only when a location crosses a damage tier', () => {
    const world = testWorld('location-scorch');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const clean = units.viewFor(world, entity);
    const cleanMeshes = meshCount(clean.model.root);
    const location = entity.locations.centre_torso;

    location.armour = location.armourMax * 0.62;
    location.rearArmour = location.rearArmourMax * 0.62;
    location.internal = location.internalMax * 0.62;
    const marked = units.viewFor(world, entity);
    expect(marked.model.root).not.toBe(clean.model.root);
    expect(meshCount(marked.model.root)).toBe(cleanMeshes);

    location.armour = location.armourMax * 0.58;
    location.rearArmour = location.rearArmourMax * 0.58;
    location.internal = location.internalMax * 0.58;
    expect(units.viewFor(world, entity).model.root).toBe(marked.model.root);

    location.armour = location.armourMax * 0.3;
    location.rearArmour = location.rearArmourMax * 0.3;
    location.internal = location.internalMax * 0.3;
    const breached = units.viewFor(world, entity);
    expect(breached.model.root).not.toBe(marked.model.root);
    expect(meshCount(breached.model.root)).toBe(cleanMeshes);
    units.dispose();
  });

  it('rebuilds a critical mount out of the visible loadout', () => {
    const world = testWorld('critical-mount-signature');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const armed = units.viewFor(world, entity);
    const mount = entity.weapons.find((candidate) => candidate.weaponId === 'ac5');
    expect(mount).toBeDefined();
    if (mount === undefined) return;

    mount.destroyed = true;
    const struck = units.viewFor(world, entity);
    expect(struck.model.root).not.toBe(armed.model.root);
    expect(struck.model.weapons.some((weapon) => weapon.weaponId === 'ac5')).toBe(false);
    units.dispose();
  });

  it('exposes placed blueprint locations in their articulated world frame', () => {
    const world = testWorld('location-anchors');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 6);
    const view = units.viewFor(world, entity);
    view.model.root.position.set(30, 6, 40);
    view.model.root.rotation.y = Math.PI / 2;

    const left = new Vector3();
    expect(units.locationOf(entity.id, 'left_arm', left)).toBe(false);
    units.beginFrame();
    units.markPlaced(entity.id);
    expect(units.locationOf(entity.id, 'left_arm', left)).toBe(true);
    const right = new Vector3();
    expect(units.locationOf(entity.id, 'right_arm', right)).toBe(true);
    expect(left.distanceTo(right)).toBeGreaterThan(1);
    expect(left.x).not.toBe(30);
    units.dispose();
  });

  it('rejects a prior-frame anchor after the authoritative sample moves', () => {
    const world = testWorld('stale-location-anchor');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    units.viewFor(world, entity);
    units.snapshot(world);
    units.beginFrame();
    const placed = units.at(entity);
    units.markPlaced(entity.id, placed);
    expect(units.locationOf(entity.id, 'centre_torso', new Vector3())).toBe(true);

    entity.pos.x += 30;
    units.snapshot(world);
    expect(units.locationOf(entity.id, 'centre_torso', new Vector3())).toBe(false);
    expect(units.canLocate(entity.id)).toBe(true);
    expect(units.currentPositionOf(entity.id)?.x).toBe(entity.pos.x);
    units.dispose();
  });

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
