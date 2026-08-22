import { Color, PointLight, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerWorld, testWorld } from '../../tests/support';
import type { SimEvent } from '../sim/events';
import { BattleEffects } from './battleEffects';
import { TacticalCamera } from './camera';
import { JetLayer } from './effects';
import { MechanicalDischargeLayer } from './mechanicalEffects';
import { TracerLayer } from './tracers';

function feedback(scene: Scene, reducedMotion = false): BattleEffects {
  return new BattleEffects(
    scene,
    new Color(0x101820),
    new TacticalCamera(reducedMotion),
    () => 0,
    () => ({ x: 120, y: 80 }),
    (_id, _weaponId, muzzle, breech) => {
      muzzle.set(10, 14, 20);
      breech.set(8, 14, 20);
      return true;
    },
    {
      anchorOf: (_id, _location, out) => {
        out.set(120, 18, 80);
        return true;
      },
      currentPositionOf: () => ({ x: 120, y: 80 }),
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('integrated combat presentation', () => {
  it('routes low-FX and reduced-motion state into both fixed effect layers', () => {
    const tracerMode = vi.spyOn(TracerLayer.prototype, 'setPresentationMode');
    const jetMode = vi.spyOn(JetLayer.prototype, 'setPresentationMode');
    const active = feedback(new Scene(), true);

    expect(tracerMode).toHaveBeenCalledWith(false, true);
    expect(jetMode).toHaveBeenCalledWith(false, true);
    active.setPresentationMode(true);
    expect(tracerMode).toHaveBeenLastCalledWith(true, true);
    expect(jetMode).toHaveBeenLastCalledWith(true, true);
    active.destroy();
  });

  it('gives hit, miss, critical, ammunition and terminal events distinct bursts', () => {
    const burst = vi.spyOn(TracerLayer.prototype, 'burst').mockImplementation(() => undefined);
    const world = testWorld('typed-combat-bursts');
    const events: SimEvent[] = [
      {
        type: 'projectile_hit', tick: 3, shooterId: 1, targetId: 2, weaponId: 'ac5',
        location: 'left_arm', damage: 12, arc: 'front',
      },
      { type: 'projectile_miss', tick: 4, shooterId: 1, targetId: 2, weaponId: 'ac5' },
      {
        type: 'critical_hit', tick: 5, entityId: 2, shooterId: 1,
        location: 'right_torso', component: 'engine',
      },
      { type: 'ammo_explosion', tick: 6, entityId: 2, location: 'right_torso', damage: 28 },
      { type: 'mech_destroyed', tick: 7, entityId: 2, method: 'centre_torso' },
    ];
    const active = feedback(new Scene());
    active.consume(world, events);

    expect(burst.mock.calls.map((call) => call[2])).toEqual([
      'hit', 'miss', 'critical', 'ammo', 'terminal',
    ]);
    active.destroy();
  });

  it('rejects hidden shooter and target traffic before any fixed-pool admission', () => {
    const fire = vi.spyOn(TracerLayer.prototype, 'fire');
    const burst = vi.spyOn(TracerLayer.prototype, 'burst');
    const mechanical = vi.spyOn(MechanicalDischargeLayer.prototype, 'fire');
    const world = playerWorld('hidden-combat-presentation');
    const ally = world.entities.find((entity) => entity.team === (world.playerTeam ?? 0));
    const enemy = world.entities.find((entity) => entity.team !== (world.playerTeam ?? 0));
    expect(world.vision).not.toBeNull();
    expect(ally).toBeDefined();
    expect(enemy).toBeDefined();
    if (world.vision === null || ally === undefined || enemy === undefined) return;
    world.vision.visible.delete(enemy.id);
    const hiddenEvents: SimEvent[] = [
      {
        type: 'weapon_fired', tick: 1, shooterId: enemy.id,
        targetId: ally.id, weaponId: 'ac5',
      },
      {
        type: 'weapon_fired', tick: 1, shooterId: ally.id,
        targetId: enemy.id, weaponId: 'ac5',
      },
      {
        type: 'projectile_hit', tick: 2, shooterId: ally.id, targetId: enemy.id,
        weaponId: 'ac5', location: 'centre_torso', damage: 8, arc: 'front',
      },
    ];
    const scene = new Scene();
    const active = feedback(scene);
    active.consume(world, Array.from({ length: 1_000 }, (_, index) => (
      hiddenEvents[index % hiddenEvents.length] as SimEvent
    )));

    expect(fire).not.toHaveBeenCalled();
    expect(burst).not.toHaveBeenCalled();
    expect(mechanical).not.toHaveBeenCalled();
    expect(scene.children.some((child) => child instanceof PointLight && child.visible)).toBe(false);

    world.vision.visible.add(enemy.id);
    active.consume(world, hiddenEvents);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(burst).toHaveBeenCalledTimes(1);
    active.destroy();
  });

  it('keeps the essential trajectory while low FX suppresses lights and discharge', () => {
    const fire = vi.spyOn(TracerLayer.prototype, 'fire');
    const mechanical = vi.spyOn(MechanicalDischargeLayer.prototype, 'fire');
    const scene = new Scene();
    const active = feedback(scene);
    const world = testWorld('low-fx-combat');
    const event: SimEvent = {
      type: 'weapon_fired', tick: 1, shooterId: 1, targetId: 2, weaponId: 'ac5',
    };

    active.setPresentationMode(true);
    active.consume(world, [event]);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(mechanical).not.toHaveBeenCalled();
    expect(scene.children.some((child) => child instanceof PointLight && child.visible)).toBe(false);

    active.setPresentationMode(false);
    active.consume(world, [event]);
    expect(fire).toHaveBeenCalledTimes(2);
    expect(mechanical).toHaveBeenCalledTimes(1);
    expect(scene.children.some((child) => child instanceof PointLight && child.visible)).toBe(true);
    active.destroy();
  });

  it('preallocates flashes and cannot recreate scene resources after teardown', () => {
    const scene = new Scene();
    const active = feedback(scene);
    const world = testWorld('preallocated-flashes');
    const event: SimEvent = {
      type: 'weapon_fired', tick: 1, shooterId: 1, targetId: 2, weaponId: 'ac5',
    };
    const initialChildren = [...scene.children];
    const lights = initialChildren.filter((child) => child instanceof PointLight);
    const add = vi.spyOn(scene, 'add');

    active.consume(world, Array.from({ length: 1_000 }, () => event));
    expect(scene.children).toEqual(initialChildren);
    expect(lights).toHaveLength(4);
    expect(add).not.toHaveBeenCalled();

    active.destroy();
    expect(scene.children).toHaveLength(0);
    active.consume(world, [event]);
    active.beginFrame(1 / 60);
    active.finishFrame(1 / 60);
    expect(scene.children).toHaveLength(0);
    expect(add).not.toHaveBeenCalled();
  });
});
