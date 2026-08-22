import { describe, expect, it } from 'vitest';
import {
  activeStartupLights,
  advanceHullRecoil,
  idleWeightCorrection,
  legPhaseFor,
  machineCulture,
  triggerHullRecoil,
  triggerStartupShudder,
} from './machineCulture';

describe('machine culture presentation', () => {
  it('dispatches welded irregularity and sealed exactness without mutable profiles', () => {
    const welded = machineCulture('linewrought');
    const sealed = machineCulture('aurelian');

    expect(welded.rightLegLag).toBeGreaterThan(0);
    expect(legPhaseFor(welded, 0.7, 1) - legPhaseFor(welded, 0.7, 0)).toBeGreaterThan(Math.PI);
    expect(welded.hydraulicSlop).toBeGreaterThan(0);
    expect(welded.idleCorrection).toBeGreaterThan(0);
    expect(welded.revealsFieldDamage).toBe(true);
    expect(welded.terminalFallSeconds).toBeGreaterThan(sealed.terminalFallSeconds);

    expect(legPhaseFor(sealed, 0.7, 1) - legPhaseFor(sealed, 0.7, 0)).toBe(Math.PI);
    expect(sealed.bobScale).toBe(0);
    expect(sealed.torsoMotionScale).toBe(0);
    expect(sealed.hydraulicSlop).toBe(0);
    expect(sealed.idleCorrection).toBe(0);
    expect(sealed.revealsFieldDamage).toBe(false);
    expect(sealed.instantTorsoTracking).toBe(true);
    expect(Object.isFrozen(welded)).toBe(true);
    expect(Object.isFrozen(sealed)).toBe(true);
  });

  it('keeps recoil exclusive to the welded hull and returns it to rest', () => {
    const welded = { kick: 0, travel: 0.2 };
    const sealed = { kick: 0, travel: 0.2 };

    triggerHullRecoil(welded, machineCulture('linewrought'), 0.8);
    triggerHullRecoil(sealed, machineCulture('aurelian'), 0.8);
    expect(welded.kick).toBe(0.4);
    expect(sealed.kick).toBe(0);

    triggerStartupShudder(welded, machineCulture('linewrought'));
    triggerStartupShudder(sealed, machineCulture('aurelian'));
    expect(welded.kick).toBeGreaterThanOrEqual(welded.travel * 1.8);
    expect(sealed.kick).toBe(0);

    for (let frame = 0; frame < 180; frame += 1) advanceHullRecoil(welded, 1 / 60);
    expect(welded.kick).toBe(0);
  });

  it('keeps sealed idle exact and sequences its lights in a bounded order', () => {
    expect(idleWeightCorrection(machineCulture('aurelian'), 12, 4)).toBe(0);
    expect(idleWeightCorrection(machineCulture('linewrought'), 12, 4)).not.toBe(0);
    const sealed = machineCulture('aurelian');
    expect(activeStartupLights(sealed, 0, 3, false)).toBe(1);
    expect(activeStartupLights(sealed, 0.17, 3, false)).toBe(2);
    expect(activeStartupLights(sealed, 30, 3, false)).toBe(3);
    expect(activeStartupLights(sealed, 0, 3, true)).toBe(3);
  });
});
