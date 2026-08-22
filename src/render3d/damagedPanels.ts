import type { Mesh } from 'three';

export interface LoosePanelRig {
  mesh: Mesh;
  restX: number;
  restZ: number;
  phase: number;
}

/** A breached plate hangs from its authored tear instead of becoming a particle. */
export function poseLoosePanels(
  panels: readonly LoosePanelRig[],
  elapsed: number,
  effort: number,
  reducedMotion: boolean,
): void {
  for (const panel of panels) {
    if (reducedMotion) {
      panel.mesh.rotation.x = panel.restX;
      panel.mesh.rotation.z = panel.restZ;
      continue;
    }
    const swing = Math.sin(elapsed * 1.9 + panel.phase) * (0.035 + effort * 0.035);
    panel.mesh.rotation.x = panel.restX + swing;
    panel.mesh.rotation.z = panel.restZ + swing * 0.55;
  }
}
