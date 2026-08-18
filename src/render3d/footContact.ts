import { Vector3 } from 'three';
import {
  alignFootToTerrain,
  createFootTerrainPose,
  liftFootVertically,
  sampleFootTerrain,
  type FootTerrainPose,
} from './footTerrain';
import type { LegPose } from './legMotion';
import type { MechModel } from './mechModel';

export interface FootContactState {
  body: number;
  legs: [number, number];
  feet: [FootTerrainPose, FootTerrainPose];
  ready: boolean;
}

const LEFT = new Vector3();
const RIGHT = new Vector3();

export function createFootContactState(): FootContactState {
  return {
    body: 0,
    legs: [0, 0],
    feet: [createFootTerrainPose(), createFootTerrainPose()],
    ready: false,
  };
}

/** A rate limit follows a normal step exactly but refuses a tile-edge pop. */
export function settleFootContact(
  state: FootContactState,
  model: MechModel,
  poses: readonly [LegPose, LegPose],
  heightAt: (x: number, y: number) => number,
  deltaSeconds: number,
): void {
  const leftLeg = model.legs[0];
  const rightLeg = model.legs[1];
  if (leftLeg === undefined || rightLeg === undefined) return;

  leftLeg.hip.position.set(leftLeg.hipRestX, leftLeg.hipRestY, leftLeg.hipRestZ);
  rightLeg.hip.position.set(rightLeg.hipRestX, rightLeg.hipRestY, rightLeg.hipRestZ);
  leftLeg.knee.rotation.z = poses[0].knee - state.legs[0];
  rightLeg.knee.rotation.z = poses[1].knee - state.legs[1];
  leftLeg.ankle.rotation.z = poses[0].ankle + state.legs[0];
  rightLeg.ankle.rotation.z = poses[1].ankle + state.legs[1];
  leftLeg.ankle.updateWorldMatrix(true, false);
  rightLeg.ankle.updateWorldMatrix(true, false);
  LEFT.setFromMatrixPosition(leftLeg.ankle.matrixWorld);
  RIGHT.setFromMatrixPosition(rightLeg.ankle.matrixWorld);
  sampleFootTerrain(
    state.feet[0], model.root, model.footprint,
    LEFT.x, LEFT.z, model.ankleClearance, heightAt,
  );
  sampleFootTerrain(
    state.feet[1], model.root, model.footprint,
    RIGHT.x, RIGHT.z, model.ankleClearance, heightAt,
  );

  const leftNeed = state.feet[0].targetY - LEFT.y;
  const rightNeed = state.feet[1].targetY - RIGHT.y;
  const plantedNeed = poses[0].planted ? leftNeed : rightNeed;
  const bodyLimit = model.legReach * 0.35;
  const oldBody = state.body;
  const wantedBody = clamp(oldBody + plantedNeed, -bodyLimit, bodyLimit);
  state.body = state.ready
    ? approach(oldBody, wantedBody, model.legReach * 8 * deltaSeconds)
    : wantedBody;
  const bodyDelta = state.body - oldBody;
  model.root.position.y += bodyDelta;

  state.legs[0] = settleLeg(
    state.legs[0],
    poses[0].planted ? 0 : leftNeed - bodyDelta,
    model.legReach,
    deltaSeconds,
  );
  state.legs[1] = settleLeg(
    state.legs[1],
    poses[1].planted ? 0 : rightNeed - bodyDelta,
    model.legReach,
    deltaSeconds,
  );
  state.ready = true;
  leftLeg.knee.rotation.z = poses[0].knee - state.legs[0];
  rightLeg.knee.rotation.z = poses[1].knee - state.legs[1];
  leftLeg.ankle.rotation.z = poses[0].ankle + state.legs[0];
  rightLeg.ankle.rotation.z = poses[1].ankle + state.legs[1];
  leftLeg.ankle.updateWorldMatrix(true, false);
  rightLeg.ankle.updateWorldMatrix(true, false);
  LEFT.setFromMatrixPosition(leftLeg.ankle.matrixWorld);
  RIGHT.setFromMatrixPosition(rightLeg.ankle.matrixWorld);
  sampleFootTerrain(
    state.feet[0], model.root, model.footprint,
    LEFT.x, LEFT.z, model.ankleClearance, heightAt,
  );
  sampleFootTerrain(
    state.feet[1], model.root, model.footprint,
    RIGHT.x, RIGHT.z, model.ankleClearance, heightAt,
  );
  finishFootContact(model, leftLeg, state.feet[0], LEFT);
  finishFootContact(model, rightLeg, state.feet[1], RIGHT);
}

export function resetFootContact(state: FootContactState, model: MechModel): void {
  state.body = 0;
  state.legs[0] = 0;
  state.legs[1] = 0;
  state.ready = false;
  for (const leg of model.legs) {
    leg.hip.position.set(leg.hipRestX, leg.hipRestY, leg.hipRestZ);
    leg.ankle.quaternion.identity();
  }
}

function settleLeg(
  current: number,
  residual: number,
  legReach: number,
  deltaSeconds: number,
): number {
  const wanted = residual > 0
    ? clamp(current + residual / Math.max(1, legReach * 0.48), 0, 1.1)
    : 0;
  return approach(current, wanted, 3.6 * deltaSeconds);
}

function finishFootContact(
  model: MechModel,
  leg: MechModel['legs'][number],
  foot: FootTerrainPose,
  ankleAt: Vector3,
): void {
  // The knee keeps the lift legible; the pivot only closes the last gap that
  // a capped hull plane cannot reach on a steep cross-slope.
  const lift = clamp(foot.targetY - ankleAt.y, 0, model.legReach * 0.35);
  liftFootVertically(model.root, leg.hip, lift);
  leg.ankle.updateWorldMatrix(true, false);
  alignFootToTerrain(leg.ankle, foot);
}

function approach(current: number, target: number, maximumDelta: number): number {
  return current + clamp(target - current, -maximumDelta, maximumDelta);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
