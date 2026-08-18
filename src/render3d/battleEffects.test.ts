import { Color, PointLight, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { testWorld } from '../../tests/support';
import type { SimEvent } from '../sim/events';
import { BattleEffects } from './battleEffects';
import { TacticalCamera } from './camera';
import { TracerLayer } from './tracers';

function effects(camera: TacticalCamera): BattleEffects {
  return new BattleEffects(
    new Scene(),
    new Color(0x1a2024),
    camera,
    () => 0,
    () => null,
    () => false,
  );
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

  it('places a weapon flash on the resolved model muzzle', () => {
    const scene = new Scene();
    const muzzle = new Vector3(41, 27, 53);
    const feedback = new BattleEffects(
      scene,
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 0,
      () => ({ x: 120, y: 80 }),
      (_id, weaponId, out) => {
        expect(weaponId).toBe('ac5');
        out.copy(muzzle);
        return true;
      },
    );
    const event: SimEvent = {
      type: 'weapon_fired',
      tick: 1,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
    };
    feedback.consume(testWorld('muzzle-flash'), [event]);

    let light: PointLight | null = null;
    scene.traverse((child) => {
      if (child instanceof PointLight) light = child;
    });
    expect(light).not.toBeNull();
    expect((light as PointLight | null)?.position.equals(muzzle)).toBe(true);
  });

  it('falls back to the interpolated shooter when no placed muzzle is valid', () => {
    const scene = new Scene();
    const feedback = new BattleEffects(
      scene,
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 3,
      (id) => (id === 1 ? { x: 12, y: 34 } : { x: 120, y: 80 }),
      () => false,
    );
    feedback.consume(testWorld('muzzle-fallback'), [{
      type: 'weapon_fired',
      tick: 1,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
    }]);

    let light: PointLight | null = null;
    scene.traverse((child) => {
      if (child instanceof PointLight) light = child;
    });
    expect((light as PointLight | null)?.position.toArray()).toEqual([12, 17, 34]);
  });

  it('forwards catalogue projectile velocity to the firing layer', () => {
    const world = testWorld('weapon-velocity');
    const fire = vi.spyOn(TracerLayer.prototype, 'fire').mockImplementation(() => undefined);
    const feedback = new BattleEffects(
      new Scene(),
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 0,
      (id) => (id === 1 ? { x: 0, y: 0 } : { x: 100, y: 0 }),
      () => false,
    );
    feedback.consume(world, [{
      type: 'weapon_fired',
      tick: 1,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
    }]);

    expect(fire.mock.calls[0]?.[4]).toBe(world.catalog.weapons.get('ac5')?.velocity);
    fire.mockRestore();
  });
});
