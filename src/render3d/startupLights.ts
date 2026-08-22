import type { Mesh } from 'three';
import { activeStartupLights, type MachineCultureProfile } from './machineCulture';

export interface StartupLightRig {
  lights: Mesh[];
  elapsed: number;
  running: boolean;
}

interface StartupModel {
  culture: Readonly<MachineCultureProfile>;
  startup: StartupLightRig | null;
}

export function advanceStartupSequence(
  model: StartupModel,
  deltaSeconds: number,
  reducedMotion: boolean,
): void {
  const startup = model.startup;
  if (startup === null || !startup.running) return;
  startup.elapsed += Math.max(0, deltaSeconds);
  const active = activeStartupLights(
    model.culture,
    startup.elapsed,
    startup.lights.length,
    reducedMotion,
  );
  for (let index = 0; index < startup.lights.length; index += 1) {
    const light = startup.lights[index];
    if (light !== undefined) light.visible = index < active;
  }
}

export function setStartupPowered(model: StartupModel, powered: boolean): void {
  const startup = model.startup;
  if (startup === null) return;
  startup.elapsed = 0;
  startup.running = powered;
  for (const light of startup.lights) light.visible = false;
}
