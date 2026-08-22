import type { MechModel } from './mechModel';
import { triggerStartupShudder } from './machineCulture';
import { setStartupPowered } from './startupLights';

export function presentMachinePowerEvent(
  model: MechModel | undefined,
  event: 'shutdown' | 'restart',
  reducedMotion: boolean,
): void {
  if (model?.faction === 'aurelian') {
    setStartupPowered(model, event === 'restart');
  } else if (model?.faction === 'linewrought' && event === 'restart' && !reducedMotion) {
    triggerStartupShudder(model.hullRecoil, model.culture);
  }
}
