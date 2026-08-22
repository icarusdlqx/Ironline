import { Color, Mesh, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog, testWorld } from '../../tests/support';
import { createTerrainGrid } from '../sim/terrain';
import { BattleEffects } from './battleEffects';
import { TacticalCamera } from './camera';
import { JetLayer, ScarLayer, SmokeLayer } from './effects';
import { FogLayer } from './fog';
import { PropLayer } from './props';
import { TracerLayer } from './tracers';

describe('battlefield layer disposal', () => {
  it('releases terrain overlays and prop batches once', () => {
    const data = catalog.maps.get('ridge_pass');
    expect(data).toBeDefined();
    if (data === undefined) return;
    const grid = createTerrainGrid(data, catalog.rules.terrain);
    const fog = new FogLayer(grid, () => 0);
    const props = new PropLayer(grid, data, () => 0);
    const fogGeometry = vi.fn();
    const propGeometry = vi.fn();
    fog.mesh.geometry.addEventListener('dispose', fogGeometry);
    (props.group.children[0] as Mesh | undefined)?.geometry.addEventListener(
      'dispose',
      propGeometry,
    );

    fog.dispose();
    fog.dispose();
    props.dispose();
    props.dispose();

    expect(fogGeometry).toHaveBeenCalledTimes(1);
    expect(propGeometry).toHaveBeenCalledTimes(1);
    expect(props.group.children).toHaveLength(0);
  });

  it('clears each fixed effect pool without a second disposal', () => {
    const jets = new JetLayer(2);
    const smoke = new SmokeLayer(new Color(0x101820));
    const scars = new ScarLayer(2);
    const jetGeometry = vi.fn();
    const smokeGeometry = vi.fn();
    const scarGeometry = vi.fn();
    (jets.group.children[0] as Mesh).geometry.addEventListener('dispose', jetGeometry);
    smoke.mesh.geometry.addEventListener('dispose', smokeGeometry);
    scars.mesh.geometry.addEventListener('dispose', scarGeometry);

    jets.dispose();
    jets.dispose();
    smoke.dispose();
    smoke.dispose();
    scars.dispose();
    scars.dispose();

    expect(jetGeometry).toHaveBeenCalledTimes(1);
    expect(smokeGeometry).toHaveBeenCalledTimes(1);
    expect(scarGeometry).toHaveBeenCalledTimes(1);
    expect(jets.group.children).toHaveLength(0);
  });

  it('removes live tracers, flashes and all other battle effects', () => {
    const scene = new Scene();
    const camera = new TacticalCamera(false);
    const effects = new BattleEffects(
      scene,
      new Color(0x101820),
      camera,
      () => 0,
      (id) => (id === 1 ? { x: 10, y: 20 } : { x: 120, y: 80 }),
      (_id, _weaponId, out) => {
        out.copy(new Vector3(10, 14, 20));
        return true;
      },
    );
    effects.consume(testWorld('dispose-battle-effects'), [{
      type: 'weapon_fired',
      tick: 1,
      shooterId: 1,
      targetId: 2,
      weaponId: 'ac5',
    }]);
    expect(scene.children.length).toBeGreaterThan(6);

    effects.destroy();
    effects.destroy();

    expect(scene.children).toHaveLength(0);
    expect(camera.shake.length()).toBe(0);
  });

  it('clears a tracer layer with a shot still in flight', () => {
    const tracers = new TracerLayer();
    tracers.fire(
      new Vector3(0, 14, 0),
      { x: 200, y: 0 },
      { style: 'slug', colour: '#ffffff', width: 2, arc: 0 },
      1,
      200,
      0xffffff,
      () => 0,
    );
    const geometryDisposed = vi.fn();
    (tracers.group.children[1] as Mesh).geometry.addEventListener(
      'dispose',
      geometryDisposed,
    );

    tracers.dispose();
    tracers.dispose();

    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(tracers.group.children).toHaveLength(0);
  });
});
