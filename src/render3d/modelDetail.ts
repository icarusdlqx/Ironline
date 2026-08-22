import { Mesh, type Object3D } from 'three';
import type { BlueprintDetail } from '../render/blueprint/types';
import { includesDetail, type ModelDetail } from './renderQuality';

const DETAIL_TAG = 'blueprintDetail';

function taggedDetail(node: Object3D): BlueprintDetail | null {
  const value = node.userData[DETAIL_TAG];
  if (value === 'structure' || value === 'surface' || value === 'hero') return value;
  return null;
}

/** Untagged render attachments predate detail levels and remain structural. */
export function blueprintDetailOf(node: Object3D): BlueprintDetail {
  return taggedDetail(node) ?? 'structure';
}

export function markBlueprintDetail(node: Object3D, detail: BlueprintDetail): void {
  node.userData[DETAIL_TAG] = detail;
  // Small inspection plates never earn an extra battlefield shadow draw.
  if (detail !== 'structure' && node instanceof Mesh) node.castShadow = false;
}

export function applyModelDetail(root: Object3D, detail: ModelDetail): void {
  root.traverse((node) => {
    const tagged = taggedDetail(node);
    if (tagged !== null) node.visible = includesDetail(detail, tagged);
  });
  root.userData.modelDetail = detail;
}
