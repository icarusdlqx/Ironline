import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { chassisBlueprint } from './blueprint';

const HULLS = [...catalog.chassis.values()];

describe('body plans', () => {
  it('builds every chassis in the catalogue', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits);
      expect(plan.parts.length, chassis.id).toBeGreaterThan(8);
      expect(plan.height, chassis.id).toBeGreaterThan(0);
      // Every gun has somewhere to hang, or it is drawn inside the hull.
      expect(Object.keys(plan.hardpoints).length, chassis.id).toBeGreaterThan(3);
    }
  });

  it('gives every machine something to stand on', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits);
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
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits);
      const walks = chassis.frame === 'mech';
      expect(plan.articulated, chassis.id).toBe(walks);
    }
  });

  it('bolts a vehicle hull down so only the turret comes round', () => {
    // A ground vehicle traverses where a mech twists. If the glacis turned with
    // the guns the silhouette would read as a mech lying down.
    for (const chassis of HULLS.filter((entry) => entry.frame === 'vehicle')) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits);
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
});
