import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { chassisBlueprint } from './blueprint';

const HULLS = [...catalog.chassis.values()];

function planFor(id: string, identity: string | null = id) {
  const chassis = catalog.chassis.get(id);
  if (chassis === undefined) throw new Error(`unknown chassis ${id}`);
  return chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, identity);
}

describe('body plans', () => {
  it('builds every chassis in the catalogue', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);
      expect(plan.parts.length, chassis.id).toBeGreaterThan(8);
      expect(plan.height, chassis.id).toBeGreaterThan(0);
      // Every gun has somewhere to hang, or it is drawn inside the hull.
      expect(Object.keys(plan.hardpoints).length, chassis.id).toBeGreaterThan(3);
    }
  });

  it('gives every machine something to stand on', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);
      const legs = plan.parts.filter(
        (part) => part.location === 'left_leg' || part.location === 'right_leg',
      );
      // Tracks, wheels, walking legs or a concrete pad — the location has to be
      // drawn either way, or a wreck greys out a limb nobody can see.
      expect(legs.length, chassis.id).toBeGreaterThan(0);
    }
  });

  it('articulates walkers and nothing else', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);
      const walks = chassis.frame === 'mech';
      expect(plan.articulated, chassis.id).toBe(walks);
    }
  });

  it('bolts a vehicle hull down so only the turret comes round', () => {
    // A ground vehicle traverses where a mech twists. If the glacis turned with
    // the guns the silhouette would read as a mech lying down.
    for (const chassis of HULLS.filter((entry) => entry.frame === 'vehicle')) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);
      const hull = plan.parts.filter((part) => part.fixed === true);
      expect(hull.length, chassis.id).toBeGreaterThan(0);

      const turret = plan.parts.filter(
        (part) => part.location === 'centre_torso' && part.fixed !== true,
      );
      expect(turret.length, chassis.id).toBeGreaterThan(0);
    }
  });

  it('draws a distinct silhouette for each kind of machine', () => {
    const forms = new Set(HULLS.map((chassis) => chassis.silhouette.form));
    expect(forms.has('tracked')).toBe(true);
    expect(forms.has('wheeled')).toBe(true);
    expect(forms.has('emplacement')).toBe(true);
  });

  it('adds identity at constant mesh cost without moving weapon anchors', () => {
    for (const id of ['sentinel_snl2', 'bulwark_bwk3', 'cairn_crn3', 'hornet_hnt2']) {
      const baseline = planFor(id, null);
      const identified = planFor(id);
      expect(identified.hardpoints, id).toEqual(baseline.hardpoints);
      expect(Math.abs(identified.parts.length - baseline.parts.length), id).toBeLessThanOrEqual(1);
    }
  });

  it('gives the Sentinel a square cab instead of the shared raked canopy', () => {
    const head = planFor('sentinel_snl2').parts.filter((part) => part.location === 'head');
    expect(head.some((part) => part.shape === 'box' && part.tone === 'deep' && part.size[2] >= 0.55)).toBe(true);
    expect(head.some((part) => part.tone === 'glass' && part.size[2] >= 0.4)).toBe(true);
  });

  it('separates the Bulwark shield from the Cairn launcher towers', () => {
    const bulwark = planFor('bulwark_bwk3');
    const cairn = planFor('cairn_crn3');
    const shield = bulwark.parts.find(
      (part) => part.location === 'left_arm' && part.tone === 'trim' && part.size[1] > 0.85,
    );
    expect(shield).toBeDefined();
    expect(cairn.parts.some((part) => part.location === 'left_arm' && part.tone === 'trim')).toBe(false);
    for (const location of ['left_torso', 'right_torso'] as const) {
      expect(cairn.parts.some(
        (part) => part.location === location && part.tone === 'plate' && part.size[1] > 0.9,
      )).toBe(true);
    }
  });

  it('throws the Gadfly knees far enough forward to read at tactical zoom', () => {
    const anonymous = planFor('hornet_hnt2', null);
    const gadfly = planFor('hornet_hnt2');
    expect(gadfly.legs.kneeForward).toBeGreaterThan(anonymous.legs.kneeForward * 1.25);
  });
});
