import {
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import type { Faction } from '../schema/faction';

export interface MachineMotionLeg {
  hip: Object3D;
  knee: Object3D;
  ankle: Object3D;
  hipRestZ: number;
}

export interface PistonLink {
  from: Object3D;
  to: Object3D;
  fromOffset: readonly [number, number, number];
  toOffset: readonly [number, number, number];
}

export interface MachineMotionRig {
  readonly faction: Faction;
  readonly root: Object3D;
  readonly pistons: InstancedMesh | null;
  readonly links: readonly PistonLink[];
  lowFx: boolean;
}

const UP = new Vector3(0, 1, 0);
const FROM = new Vector3();
const TO = new Vector3();
const MIDPOINT = new Vector3();
const DIRECTION = new Vector3();
const SCALE = new Vector3(1, 1, 1);
const TURN = new Quaternion();
const MATRIX = new Matrix4();
const ROOT_INVERSE = new Matrix4();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const NO_LINKS: readonly PistonLink[] = Object.freeze([]);

function legLinks(leg: MachineMotionLeg, side: number, scale: number): PistonLink[] {
  const outboard = side * scale * 0.13;
  return [
    {
      from: leg.hip,
      to: leg.knee,
      fromOffset: [scale * 0.04, -scale * 0.06, outboard],
      toOffset: [scale * 0.07, scale * 0.08, outboard],
    },
    {
      from: leg.knee,
      to: leg.ankle,
      fromOffset: [-scale * 0.05, -scale * 0.08, outboard],
      toOffset: [scale * 0.02, scale * 0.07, outboard],
    },
  ];
}

/** One dynamic batch makes the welded leg actuators cost one draw, not four. */
export function createMachineMotion(
  faction: Faction,
  root: Object3D,
  legs: readonly MachineMotionLeg[],
  scale: number,
  material: Material,
): MachineMotionRig {
  if (faction !== 'linewrought' || legs.length !== 2) {
    return { faction, root, pistons: null, links: NO_LINKS, lowFx: false };
  }

  const links = legs.flatMap((leg, index) => {
    const side = Math.sign(leg.hipRestZ) || (index === 0 ? -1 : 1);
    return legLinks(leg, side, scale);
  });
  const pistons = new InstancedMesh(
    new CylinderGeometry(scale * 0.022, scale * 0.022, 1, 6),
    material,
    links.length,
  );
  pistons.name = 'linewrought-pistons';
  pistons.castShadow = false;
  pistons.frustumCulled = false;
  pistons.instanceMatrix.setUsage(DynamicDrawUsage);
  root.add(pistons);

  const rig = { faction, root, pistons, links, lowFx: false };
  poseMachineMotion(rig);
  return rig;
}

/** Rebuilds the four matrices from the existing joint frames. */
export function poseMachineMotion(rig: MachineMotionRig): void {
  const pistons = rig.pistons;
  if (pistons === null || rig.lowFx) return;

  rig.root.updateWorldMatrix(true, true);
  ROOT_INVERSE.copy(rig.root.matrixWorld).invert();
  for (let index = 0; index < rig.links.length; index += 1) {
    const pair = rig.links[index];
    if (pair === undefined) continue;
    FROM.set(pair.fromOffset[0], pair.fromOffset[1], pair.fromOffset[2])
      .applyMatrix4(pair.from.matrixWorld)
      .applyMatrix4(ROOT_INVERSE);
    TO.set(pair.toOffset[0], pair.toOffset[1], pair.toOffset[2])
      .applyMatrix4(pair.to.matrixWorld)
      .applyMatrix4(ROOT_INVERSE);
    DIRECTION.subVectors(TO, FROM);
    const length = DIRECTION.length();
    if (length <= 1e-6) {
      pistons.setMatrixAt(index, HIDDEN);
      continue;
    }
    MIDPOINT.addVectors(FROM, TO).multiplyScalar(0.5);
    TURN.setFromUnitVectors(UP, DIRECTION.multiplyScalar(1 / length));
    SCALE.set(1, length, 1);
    pistons.setMatrixAt(index, MATRIX.compose(MIDPOINT, TURN, SCALE));
  }
  pistons.instanceMatrix.needsUpdate = true;
}

export function setMachineMotionLowFx(rig: MachineMotionRig, lowFx: boolean): void {
  rig.lowFx = lowFx;
  if (rig.pistons === null) return;
  rig.pistons.visible = !lowFx;
  if (!lowFx) poseMachineMotion(rig);
}
