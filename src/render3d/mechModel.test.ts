import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import { buildMechModel, disposeModel } from './mechModel';
import { advanceStartupSequence } from './startupLights';
import { poseLoosePanels } from './damagedPanels';

describe('mech model resources', () => {
  it('disposes shared and unattached owned resources once', () => {
    const root = new Group();
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const unused = new MeshStandardMaterial();
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    root.userData.ownedMaterials = [material, material, unused];
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const unusedDispose = vi.spyOn(unused, 'dispose');

    disposeModel(root);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(unusedDispose).toHaveBeenCalledTimes(1);
  });

  it('builds hip, knee and ankle pivots without adding visible parts', () => {
    const chassis = catalog.chassis.get('sentinel_snl2');
    expect(chassis).toBeDefined();
    if (chassis === undefined) return;
    const model = buildMechModel(
      chassis.silhouette,
      chassis.traits,
      chassis.tonnage,
      0x78c9ff,
      false,
      [],
      new Set(),
      chassis.hardpoints,
      chassis.id,
      {},
      chassis.faction,
    );

    expect(model.motion?.form).toBe('humanoid');
    expect(model.legReach).toBeGreaterThan(model.strideLength);
    expect(model.root.rotation.order).toBe('YXZ');
    expect(model.torso.rotation.order).toBe('YXZ');
    expect(model.legs).toHaveLength(2);
    for (const leg of model.legs) {
      expect(leg.knee.parent).toBe(leg.hip);
      expect(leg.ankle.parent).toBe(leg.knee);
      expect(leg.ankle.children.length).toBeGreaterThan(0);
    }
    disposeModel(model.root);
  });

  it('pulls one coarse welded panel loose at a breached location', () => {
    const chassis = catalog.chassis.get('hornet_hnt2');
    expect(chassis?.faction).toBe('linewrought');
    if (chassis === undefined) return;
    const model = buildMechModel(
      chassis.silhouette, chassis.traits, chassis.tonnage, 0x78c9ff, false, [],
      new Set(), chassis.hardpoints, chassis.id, { left_torso: 2 }, chassis.faction,
    );
    let loose = 0;
    model.root.traverse((node) => {
      if (node.userData.loosePanel === true) loose += 1;
    });
    expect(loose).toBe(1);
    expect(model.loosePanels).toHaveLength(1);
    const panel = model.loosePanels[0];
    expect(panel).toBeDefined();
    if (panel === undefined) return;
    poseLoosePanels(model.loosePanels, 0.5, 1, false);
    expect(panel.mesh.rotation.x).not.toBe(panel.restX);
    poseLoosePanels(model.loosePanels, 1, 1, true);
    expect(panel.mesh.rotation.x).toBe(panel.restX);
    disposeModel(model.root);
  });

  it('keeps a damaged sealed shell visually complete until terminal failure', () => {
    const chassis = catalog.chassis.get('sentinel_snl2');
    expect(chassis?.faction).toBe('aurelian');
    if (chassis === undefined) return;
    const model = buildMechModel(
      chassis.silhouette, chassis.traits, chassis.tonnage, 0x78c9ff, false, [],
      new Set(['left_arm']), chassis.hardpoints, chassis.id, { left_arm: 2 }, chassis.faction,
    );
    let armMeshes = 0;
    let loose = 0;
    model.root.traverse((node) => {
      if (node.userData.damageLocation === 'left_arm') armMeshes += 1;
      if (node.userData.loosePanel === true) loose += 1;
    });
    expect(armMeshes).toBeGreaterThan(0);
    expect(loose).toBe(0);
    disposeModel(model.root);
  });

  it('sequences a fixed three-light sealed startup without growing the model', () => {
    const chassis = catalog.chassis.get('sentinel_snl2');
    if (chassis === undefined) return;
    const model = buildMechModel(
      chassis.silhouette, chassis.traits, chassis.tonnage, 0x78c9ff, false, [],
      new Set(), chassis.hardpoints, chassis.id, {}, chassis.faction,
    );
    expect(model.startup?.lights).toHaveLength(3);
    const children = model.torso.children.length;
    advanceStartupSequence(model, 0, false);
    expect(model.startup?.lights.filter((light) => light.visible)).toHaveLength(1);
    advanceStartupSequence(model, 0.17, false);
    expect(model.startup?.lights.filter((light) => light.visible)).toHaveLength(2);
    for (let frame = 0; frame < 10_000; frame += 1) {
      advanceStartupSequence(model, 1 / 60, false);
    }
    expect(model.startup?.lights.every((light) => light.visible)).toBe(true);
    expect(model.torso.children).toHaveLength(children);
    disposeModel(model.root);
  });
});
