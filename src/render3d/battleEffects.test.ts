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

  it('places impact flashes on the struck blueprint location', () => {
    const impact = vi.spyOn(TracerLayer.prototype, 'impact').mockImplementation(() => undefined);
    const feedback = new BattleEffects(
      new Scene(),
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 3,
      () => ({ x: 120, y: 80 }),
      () => false,
      {
        anchorOf: (_id, location, out) => {
          expect(location).toBe('left_arm');
          out.set(41, 27, 53);
          return true;
        },
      },
    );
    feedback.consume(testWorld('localized-impact'), [{
      type: 'projectile_hit',
      tick: 4,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
      location: 'left_arm',
      damage: 8,
      arc: 'front',
    }]);

    const call = impact.mock.calls[0];
    expect(call === undefined ? null : [call[0].x, call[0].y, call[1]]).toEqual([41, 53, 13]);
    impact.mockRestore();
  });

  it('falls back to the hull centre when no location model is placed', () => {
    const impact = vi.spyOn(TracerLayer.prototype, 'impact').mockImplementation(() => undefined);
    const feedback = new BattleEffects(
      new Scene(),
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 3,
      (id) => (id === 2 ? { x: 120, y: 80 } : null),
      () => false,
      {
        anchorOf: () => false,
        canLocate: () => true,
        currentPositionOf: () => ({ x: 220, y: 180 }),
      },
    );
    feedback.consume(testWorld('impact-fallback'), [{
      type: 'projectile_hit',
      tick: 4,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
      location: 'left_arm',
      damage: 8,
      arc: 'front',
    }]);

    const call = impact.mock.calls[0];
    expect(call === undefined ? null : [call[0].x, call[0].y, call[1]]).toEqual([220, 180, 3]);
    impact.mockRestore();
  });

  it('does not fall back through an unplaced or hidden model', () => {
    const impact = vi.spyOn(TracerLayer.prototype, 'impact').mockImplementation(() => undefined);
    const feedback = new BattleEffects(
      new Scene(),
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 3,
      () => ({ x: 120, y: 80 }),
      () => false,
      {
        anchorOf: () => false,
        canLocate: () => false,
        currentPositionOf: () => ({ x: 220, y: 180 }),
      },
    );
    feedback.consume(testWorld('hidden-impact'), [{
      type: 'projectile_hit',
      tick: 4,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
      location: 'left_arm',
      damage: 8,
      arc: 'front',
    }]);

    expect(impact).not.toHaveBeenCalled();
    impact.mockRestore();
  });

  it('opens ammunition smoke at the breached location', () => {
    const smoke = vi.spyOn(TracerLayer.prototype, 'spawnSmoke').mockImplementation(() => undefined);
    const feedback = new BattleEffects(
      new Scene(),
      new Color(0x1a2024),
      new TacticalCamera(false),
      () => 0,
      () => ({ x: 0, y: 0 }),
      () => false,
      {
        anchorOf: (_id, _location, out) => {
          out.set(17, 31, 29);
          return true;
        },
      },
    );
    feedback.consume(testWorld('localized-ammo'), [{
      type: 'ammo_explosion',
      tick: 5,
      entityId: 2,
      location: 'right_torso',
      damage: 25,
    }]);

    const call = smoke.mock.calls[0];
    expect(call === undefined ? null : [call[0].x, call[0].y, call[1]]).toEqual([17, 29, 17]);
    smoke.mockRestore();
  });
});
