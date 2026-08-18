import { Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import { createFootContactState, settleFootContact } from './footContact';
import { writeStridePose, type LegPose } from './legMotion';
import { buildMechModel, disposeModel } from './mechModel';
import { strideSwing } from './motionProfiles';

describe('per-foot terrain contact', () => {
  it('lifts the crossing foot over a crest without snapping the planted hull', () => {
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
    );
    const left: LegPose = { hip: 0, knee: 0, ankle: 0, planted: true };
    const right: LegPose = { hip: 0, knee: 0, ankle: 0, planted: false };
    const swing = strideSwing(model.strideLength, model.legReach);
    writeStridePose(left, Math.PI * 0.75, swing, 0.5, 0);
    writeStridePose(right, Math.PI * 1.75, swing, 0.5, 0);
    const leftRig = model.legs[0];
    const rightRig = model.legs[1];
    expect(leftRig).toBeDefined();
    expect(rightRig).toBeDefined();
    if (leftRig === undefined || rightRig === undefined) return;
    leftRig.hip.rotation.z = left.hip;
    leftRig.knee.rotation.z = left.knee;
    leftRig.ankle.rotation.z = left.ankle;
    rightRig.hip.rotation.z = right.hip;
    rightRig.knee.rotation.z = right.knee;
    rightRig.ankle.rotation.z = right.ankle;

    const ridge = (_x: number, y: number): number => y <= 0 ? 0 : 3;
    const contact = createFootContactState();
    const torsoTraversal = vi.spyOn(model.torso, 'updateMatrixWorld');
    settleFootContact(contact, model, [left, right], ridge, 1 / 60);
    expect(torsoTraversal).not.toHaveBeenCalled();
    expect(contact.legs[1]).toBeGreaterThan(0);
    expect(contact.legs[1]).toBeLessThan(0.1);
    for (let frame = 0; frame < 30; frame += 1) {
      settleFootContact(contact, model, [left, right], ridge, 1 / 60);
    }

    model.root.updateMatrixWorld(true);
    const planted = leftRig.ankle.getWorldPosition(new Vector3());
    const crossing = rightRig.ankle.getWorldPosition(new Vector3());
    const crossingSole = new Vector3(1, 0, 0).applyQuaternion(
      rightRig.ankle.getWorldQuaternion(new Quaternion()),
    );
    expect(planted.y - ridge(planted.x, planted.z)).toBeCloseTo(model.ankleClearance, 6);
    expect(crossing.y - ridge(crossing.x, crossing.z))
      .toBeGreaterThanOrEqual(model.ankleClearance - 0.05);
    expect(crossingSole.y).toBeCloseTo(0, 8);
    disposeModel(model.root);
  });
});
