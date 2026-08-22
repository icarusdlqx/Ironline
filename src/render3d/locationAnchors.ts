import { Mesh, Object3D, Vector3 } from 'three';
import { LOCATIONS, type MechLocation } from '../schema/common';
import { blueprintDetailOf } from './modelDetail';

export type LocationAnchors = Partial<Record<MechLocation, Mesh[]>>;

const PART_AT = new Vector3();

function damageLocation(node: Object3D): MechLocation | null {
  if (blueprintDetailOf(node) !== 'structure') return null;
  const value = node.userData.damageLocation;
  if (typeof value !== 'string') return null;
  return LOCATIONS.includes(value as MechLocation) ? (value as MechLocation) : null;
}

export function collectLocationAnchors(root: Object3D): LocationAnchors {
  const anchors: LocationAnchors = {};
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const location = damageLocation(node);
    if (location === null) return;
    const list = anchors[location] ?? [];
    list.push(node);
    anchors[location] = list;
  });
  return anchors;
}

/** A plate cluster follows the actual torso and leg joints without another scene object. */
export function locationWorldAnchor(
  anchors: LocationAnchors,
  location: MechLocation,
  out: Vector3,
): boolean {
  const parts = anchors[location];
  if (parts === undefined || parts.length === 0) return false;

  out.set(0, 0, 0);
  for (const part of parts) {
    part.updateWorldMatrix(true, false);
    PART_AT.setFromMatrixPosition(part.matrixWorld);
    out.add(PART_AT);
  }
  out.multiplyScalar(1 / parts.length);
  return true;
}
