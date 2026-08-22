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
    const entity = unitOf(world, 'hornet_spotter');
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
    const entity = unitOf(world, 'hornet_spotter');
    const units = new UnitViews(new Scene(), () => 0);
    const armed = units.viewFor(world, entity);
    const mount = entity.weapons.find((candidate) => candidate.weaponId === 'flamer');
    expect(mount).toBeDefined();
    if (mount === undefined) return;

    mount.destroyed = true;
    const struck = units.viewFor(world, entity);
    expect(struck.model.root).not.toBe(armed.model.root);
    expect(struck.model.weapons.some((weapon) => weapon.weaponId === 'flamer')).toBe(false);
    units.dispose();
  });

  it('keeps sealed damage inside the shell until the terminal drop', () => {
    const world = testWorld('sealed-damage-signature');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const clean = units.viewFor(world, entity);
    entity.locations.left_arm.armour = 0;
    entity.locations.left_arm.internal = 0;
    entity.locations.left_arm.destroyed = true;
    const mount = entity.weapons.find((candidate) => candidate.weaponId === 'ac5');
    if (mount !== undefined) mount.destroyed = true;

    expect(units.viewFor(world, entity).model.root).toBe(clean.model.root);
    entity.destroyed = true;
    expect(units.viewFor(world, entity).model.root).not.toBe(clean.model.root);
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
    const entity = unitOf(world, 'bulwark_assault');
    const units = new UnitViews(new Scene(), () => 0);
    const rig = units.viewFor(world, entity).model.weapons.find((candidate) => candidate.weaponId === 'ac5');
    expect(rig).toBeDefined();
    if (rig === undefined) return;

    units.beginFrame();
    units.markPlaced(entity.id);
    const muzzle = new Vector3();
    const breech = new Vector3();
    expect(units.fireMount(entity.id, 'ac5', muzzle, breech)).toBe(true);
    expect(muzzle.distanceTo(breech)).toBeGreaterThan(0);
    expect(rig.kick).toBe(rig.travel);
    expect(units.viewFor(world, entity).model.hullRecoil.kick).toBeGreaterThan(0);
    units.beginFrame(1 / 30);
    expect(rig.slide.position.x).toBeLessThan(0);
    expect(rig.kick).toBeLessThan(rig.travel);
    units.dispose();
  });

  it('absorbs captured ballistic recoil inside a sealed hull', () => {
    const world = testWorld('sealed-weapon-recoil');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const view = units.viewFor(world, entity);
    const rig = view.model.weapons.find((candidate) => candidate.weaponId === 'ac5');
    expect(rig).toBeDefined();
    if (rig === undefined) return;

    units.beginFrame();
    units.markPlaced(entity.id);
    expect(units.fireMount(entity.id, 'ac5', new Vector3())).toBe(true);
    expect(rig.kick).toBe(0);
    expect(view.model.hullRecoil.kick).toBe(0);
    units.dispose();
  });

  it('tracks a sealed target bearing while the sim torso is still stale', () => {
    const world = testWorld('culture-torso-tracking');
    const sealed = unitOf(world, 'sentinel_brawler');
    const welded = unitOf(world, 'hornet_spotter');
    const target = unitOf(world, 'halberd_prime');
    const units = new UnitViews(new Scene(), () => 0);
    sealed.pos = { x: 100, y: 100 };
    welded.pos = { x: 200, y: 100 };
    target.pos = { x: 300, y: 100 };
    sealed.facing = 0;
    welded.facing = 0;
    sealed.torsoOffset = 0;
    welded.torsoOffset = 0;
    sealed.targetId = target.id;
    welded.targetId = target.id;
    units.snapshot(world);
    target.pos = { x: 100, y: 300 };
    units.snapshot(world);
    units.interpolate(world, 0.25);

    expect(sealed.torsoOffset).toBe(0);
    expect(units.at(sealed).torso).toBeCloseTo(Math.min(Math.PI / 2, sealed.twistLimit));
    expect(units.at(welded).torso).toBe(0);

    sealed.targetId = null;
    sealed.torsoOffset = 0.3;
    units.interpolate(world, 0.25);
    expect(units.at(sealed).torso).toBe(0.3);
    units.dispose();
  });

  it('starts sealed lights on reveal and sequences them again after a restart', () => {
    const world = testWorld('sealed-startup-events');
    const entity = unitOf(world, 'sentinel_brawler');
    const units = new UnitViews(new Scene(), () => 0);
    const view = units.viewFor(world, entity);
    expect(view.model.startup?.lights).toHaveLength(3);
    view.model.root.visible = false;
    units.beginFrame(2);
    expect(view.model.startup?.lights.some((light) => light.visible)).toBe(false);

    view.model.root.visible = true;
    units.beginFrame(0.17);
    expect(view.model.startup?.lights.filter((light) => light.visible)).toHaveLength(2);
    units.consumeEvents([{ type: 'shutdown', tick: 4, entityId: entity.id, forced: false }]);
    units.beginFrame(2);
    expect(view.model.startup?.lights.some((light) => light.visible)).toBe(false);
    units.consumeEvents([{ type: 'restart', tick: 8, entityId: entity.id }]);
    units.beginFrame(0);
    expect(view.model.startup?.lights.filter((light) => light.visible)).toHaveLength(1);
    units.dispose();
  });

  it('keeps a late-created shutdown sealed view dark until its restart event', () => {
    const world = testWorld('sealed-late-shutdown');
    const entity = unitOf(world, 'sentinel_brawler');
    entity.shutdownRemaining = 2;
    const units = new UnitViews(new Scene(), () => 0);
    const view = units.viewFor(world, entity);
    units.beginFrame(2);
    expect(view.model.startup?.lights.some((light) => light.visible)).toBe(false);
    units.consumeEvents([{ type: 'restart', tick: 8, entityId: entity.id }]);
    units.beginFrame(0);
    expect(view.model.startup?.lights.filter((light) => light.visible)).toHaveLength(1);
    units.dispose();
  });

  it('shudders a welded restart without adding hull motion under reduced motion', () => {
    const world = testWorld('welded-restart-shudder');
    const entity = unitOf(world, 'bulwark_assault');
    const active = new UnitViews(new Scene(), () => 0);
    const activeView = active.viewFor(world, entity);
    active.consumeEvents([{ type: 'restart', tick: 8, entityId: entity.id }]);
    expect(activeView.model.hullRecoil.kick).toBeGreaterThan(0);

    const reduced = new UnitViews(new Scene(), () => 0, true);
    const reducedView = reduced.viewFor(world, entity);
    const rig = reducedView.model.weapons.find((candidate) => candidate.weaponId === 'ac5');
    expect(rig).toBeDefined();
    if (rig === undefined) return;
    reduced.beginFrame();
    reduced.markPlaced(entity.id);
    expect(reduced.fireMount(entity.id, 'ac5', new Vector3())).toBe(true);
    expect(rig.kick).toBe(rig.travel);
    expect(reducedView.model.hullRecoil.kick).toBe(0);
    reduced.consumeEvents([{ type: 'restart', tick: 8, entityId: entity.id }]);
    expect(reducedView.model.hullRecoil.kick).toBe(0);
    active.dispose();
    reduced.dispose();
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
