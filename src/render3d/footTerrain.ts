import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { Footprint } from './mechModel';

export interface FootTerrainPose {
  normalX: number;
  normalY: number;
  normalZ: number;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  lateralX: number;
  lateralY: number;
  lateralZ: number;
  targetY: number;
}

const MAX_GRADE = 1.2;
const FORWARD = new Vector3();
const UP = new Vector3();
const LATERAL = new Vector3();
const FRAME = new Matrix4();
const PARENT_FRAME = new Matrix4();
const WORLD_ROTATION = new Quaternion();
const PARENT_ROTATION = new Quaternion();
const WORLD_LIFT = new Vector3();

export function createFootTerrainPose(): FootTerrainPose {
  return {
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    forwardX: 1,
    forwardY: 0,
    forwardZ: 0,
    lateralX: 0,
    lateralY: 0,
    lateralZ: 1,
    targetY: 0,
  };
}

/** A boot-sized sample softens tile seams while retaining the grade beneath each leg. */
export function sampleFootTerrain(
  out: FootTerrainPose,
  root: Object3D,
  footprint: Footprint,
  ankleX: number,
  ankleZ: number,
  clearance: number,
  heightAt: (x: number, y: number) => number,
): void {
  const length = footprint.maxForward - footprint.minForward;
  const span = Math.max(0.75, length * 0.5, footprint.halfWidth);
  let gradeX = (heightAt(ankleX + span, ankleZ) - heightAt(ankleX - span, ankleZ)) / (span * 2);
  let gradeY = (heightAt(ankleX, ankleZ + span) - heightAt(ankleX, ankleZ - span)) / (span * 2);
  const grade = Math.hypot(gradeX, gradeY);
  if (grade > MAX_GRADE) {
    const bound = MAX_GRADE / grade;
    gradeX *= bound;
    gradeY *= bound;
  }

  const normalScale = 1 / Math.sqrt(1 + gradeX * gradeX + gradeY * gradeY);
  UP.set(-gradeX * normalScale, normalScale, -gradeY * normalScale);
  const elements = root.matrixWorld.elements;
  FORWARD.set(elements[0] ?? 1, elements[1] ?? 0, elements[2] ?? 0);
  FORWARD.addScaledVector(UP, -FORWARD.dot(UP)).normalize();
  LATERAL.crossVectors(FORWARD, UP).normalize();
  FORWARD.crossVectors(UP, LATERAL).normalize();

  out.normalX = UP.x;
  out.normalY = UP.y;
  out.normalZ = UP.z;
  out.forwardX = FORWARD.x;
  out.forwardY = FORWARD.y;
  out.forwardZ = FORWARD.z;
  out.lateralX = LATERAL.x;
  out.lateralY = LATERAL.y;
  out.lateralZ = LATERAL.z;
  out.targetY = requiredAnkleHeight(out, footprint, ankleX, ankleZ, clearance, heightAt);
}

/** The highest sole sample wins, so a convex tile seam cannot cut through the boot. */
function requiredAnkleHeight(
  pose: FootTerrainPose,
  footprint: Footprint,
  ankleX: number,
  ankleZ: number,
  clearance: number,
  heightAt: (x: number, y: number) => number,
): number {
  let required = Number.NEGATIVE_INFINITY;
  for (let along = 0; along <= 6; along += 1) {
    const forward = footprint.minForward
      + (footprint.maxForward - footprint.minForward) * along / 6;
    for (let across = -1; across <= 1; across += 1) {
      const lateral = footprint.halfWidth * across;
      const x = ankleX + forward * pose.forwardX + lateral * pose.lateralX
        - clearance * pose.normalX;
      const z = ankleZ + forward * pose.forwardZ + lateral * pose.lateralZ
        - clearance * pose.normalZ;
      const soleY = forward * pose.forwardY + lateral * pose.lateralY
        - clearance * pose.normalY;
      required = Math.max(required, heightAt(x, z) - soleY);
    }
  }
  return required;
}

/** Converts the world ground frame through the knee without touching hull readability. */
export function alignFootToTerrain(ankle: Object3D, pose: FootTerrainPose): void {
  const parent = ankle.parent;
  if (parent === null) return;
  parent.updateWorldMatrix(true, false);
  FORWARD.set(pose.forwardX, pose.forwardY, pose.forwardZ);
  UP.set(pose.normalX, pose.normalY, pose.normalZ);
  LATERAL.set(pose.lateralX, pose.lateralY, pose.lateralZ);
  FRAME.makeBasis(FORWARD, UP, LATERAL);
  WORLD_ROTATION.setFromRotationMatrix(FRAME);
  PARENT_FRAME.extractRotation(parent.matrixWorld);
  PARENT_ROTATION.setFromRotationMatrix(PARENT_FRAME).invert();
  ankle.quaternion.copy(PARENT_ROTATION).multiply(WORLD_ROTATION);
}

export function liftFootVertically(root: Object3D, hip: Object3D, distance: number): void {
  if (distance <= 0) return;
  PARENT_FRAME.extractRotation(root.matrixWorld);
  PARENT_ROTATION.setFromRotationMatrix(PARENT_FRAME).invert();
  WORLD_LIFT.set(0, distance, 0).applyQuaternion(PARENT_ROTATION);
  hip.position.add(WORLD_LIFT);
}
