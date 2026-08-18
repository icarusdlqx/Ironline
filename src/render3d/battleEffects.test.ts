import { Color, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { BattleEffects } from './battleEffects';
import { TacticalCamera } from './camera';

function effects(camera: TacticalCamera): BattleEffects {
  return new BattleEffects(new Scene(), new Color(0x1a2024), camera, () => 0, () => null);
}

describe('battle camera feedback', () => {
  it('keeps impacts still when reduced motion is requested', () => {
    const camera = new TacticalCamera(true);
    effects(camera).land({ x: 0, y: 0 }, 0xffffff, 5);

    expect(camera.shake.length()).toBe(0);
  });

  it('retains impact weight for players who allow motion', () => {
    const camera = new TacticalCamera(false);
    const feedback = effects(camera);
    feedback.land({ x: 0, y: 0 }, 0xffffff, 5);
    feedback.finishFrame(1 / 60);

    expect(camera.shake.length()).toBeGreaterThan(0);
  });
});
