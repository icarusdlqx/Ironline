import { Matrix4, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MechanicalDischargeLayer } from './mechanicalEffects';

describe('mechanical discharge budget', () => {
  it('vents a rail discharge without inventing a casing', () => {
    const layer = new MechanicalDischargeLayer(4, 3);
    layer.fire(new Vector3(4, 18, 7), 0, 1.4, false, 0);

    expect(layer.casings.count).toBe(0);
    expect(layer.vents.count).toBe(1);
    layer.dispose();
  });

  it('reuses fixed casing and vent slots through sustained fire', () => {
    const layer = new MechanicalDischargeLayer(4, 3);
    const casingGeometry = layer.casings.geometry;
    const ventGeometry = layer.vents.geometry;
    for (let shot = 0; shot < 500; shot += 1) {
      layer.fire(new Vector3(shot, 18, 7), shot * 0.1, 1, true, 0);
      layer.update(1 / 60);
    }

    expect(layer.casings.count).toBe(4);
    expect(layer.vents.count).toBe(3);
    expect(layer.casings.instanceMatrix.count).toBe(4);
    expect(layer.vents.instanceMatrix.count).toBe(3);
    expect(layer.casings.geometry).toBe(casingGeometry);
    expect(layer.vents.geometry).toBe(ventGeometry);

    layer.update(2);
    const hidden = new Matrix4();
    layer.casings.getMatrixAt(0, hidden);
    expect(hidden.elements[0]).toBe(0);
    layer.dispose();
  });

  it('disposes its fixed resources once', () => {
    const layer = new MechanicalDischargeLayer(2, 2);
    layer.fire(new Vector3(), 0, 1, true, 0);
    const casing = vi.spyOn(layer.casings.geometry, 'dispose');
    const vent = vi.spyOn(layer.vents.geometry, 'dispose');
    const casingInstances = vi.fn();
    const ventInstances = vi.fn();
    layer.casings.addEventListener('dispose', casingInstances);
    layer.vents.addEventListener('dispose', ventInstances);

    layer.dispose();
    layer.dispose();

    expect(casing).toHaveBeenCalledTimes(1);
    expect(vent).toHaveBeenCalledTimes(1);
    expect(casingInstances).toHaveBeenCalledTimes(1);
    expect(ventInstances).toHaveBeenCalledTimes(1);
    expect(layer.casings.count).toBe(0);
    expect(layer.vents.count).toBe(0);
    layer.fire(new Vector3(), 0, 1, true, 0);
    expect(layer.casings.count).toBe(0);
    expect(layer.vents.count).toBe(0);
  });
});
