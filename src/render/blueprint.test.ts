import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { LOCATIONS, type MechLocation } from '../schema/common';
import { chassisBlueprint, type Blueprint, type BlueprintPart } from './blueprint';

const HULLS = [...catalog.chassis.values()];
const AURELIAN_IDS = [
  'wisp_wsp1',
  'votive_vtv2',
  'sentinel_snl2',
  'falchion_fal2',
  'warden_wrd5',
  'halberd_hlb4',
  'obsequy_obq3',
  'pallvault_plv1',
] as const;

const MIRRORED_LOCATION: Partial<Record<MechLocation, MechLocation>> = {
  left_arm: 'right_arm',
  right_arm: 'left_arm',
  left_torso: 'right_torso',
  right_torso: 'left_torso',
  left_leg: 'right_leg',
  right_leg: 'left_leg',
};

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function mirrorLocation(location: MechLocation | null): MechLocation | null {
  return location === null ? null : (MIRRORED_LOCATION[location] ?? location);
}

function partKey(part: BlueprintPart, mirrored = false): string {
  const at = mirrored
    ? [part.at[0], part.at[1], -part.at[2]].map(cleanZero)
    : part.at.map(cleanZero);
  return JSON.stringify([
    mirrored ? mirrorLocation(part.location) : part.location,
    part.shape,
    at,
    part.size,
    part.tone,
    part.tilt ?? null,
    part.fixed ?? false,
    part.joint ?? null,
    part.profile ?? null,
    part.transverse ?? null,
  ]);
}

function anchorKeys(plan: Blueprint, mirrored = false): string[] {
  return (Object.entries(plan.hardpoints) as [MechLocation, [number, number, number]][])
    .map(([location, anchor]) => JSON.stringify([
      mirrored ? mirrorLocation(location) : location,
      [anchor[0], anchor[1], mirrored ? cleanZero(-anchor[2]) : cleanZero(anchor[2])],
    ]))
    .sort();
}

function planSignature(plan: Blueprint): string {
  return plan.parts.map((part) => partKey(part)).sort().join('|');
}

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

  it('names every walking pivot and measures the full leg chain', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);
      const legs = plan.parts.filter(
        (part) => part.location === 'left_leg' || part.location === 'right_leg',
      );
      if (chassis.frame !== 'mech') {
        expect(legs.every((part) => part.joint === undefined), chassis.id).toBe(true);
        continue;
      }

      expect(new Set(legs.map((part) => part.joint)), chassis.id)
        .toEqual(new Set(['hip', 'knee', 'ankle']));
      expect(plan.legs.hipHeight, chassis.id).toBeGreaterThan(plan.legs.kneeHeight);
      expect(plan.legs.kneeHeight, chassis.id).toBeGreaterThan(plan.legs.ankleHeight);
      expect(plan.legs.reach, chassis.id).toBeGreaterThan(plan.legs.hipHeight * 0.9);
      expect(plan.legs.stanceReach, chassis.id).toBeCloseTo(Math.hypot(
        plan.legs.ankleForward,
        plan.legs.hipHeight - plan.legs.ankleHeight,
      ));
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

  it('adds welded identity at constant mesh cost without moving weapon anchors', () => {
    for (const id of ['bulwark_bwk3', 'cairn_crn3', 'hornet_hnt2']) {
      const baseline = planFor(id, null);
      const identified = planFor(id);
      expect(identified.hardpoints, id).toEqual(baseline.hardpoints);
      const structure = identified.parts.filter((part) => part.detail === 'structure');
      expect(Math.abs(structure.length - baseline.parts.length), id).toBeLessThanOrEqual(1);
    }
  });

  it('dispatches every Aurelian chassis to its own body plan', () => {
    const catalogueIds = HULLS
      .filter((chassis) => chassis.faction === 'aurelian')
      .map((chassis) => chassis.id)
      .sort();
    expect(catalogueIds).toEqual([...AURELIAN_IDS].sort());

    const signatures = AURELIAN_IDS.map((id) => {
      const identified = planFor(id);
      expect(planSignature(identified), id).not.toBe(planSignature(planFor(id, null)));
      return planSignature(identified);
    });

    expect(new Set(signatures).size).toBe(AURELIAN_IDS.length);
  });

  it('keeps sealed shells and their weapon anchors bilaterally symmetric', () => {
    for (const id of AURELIAN_IDS) {
      const plan = planFor(id);
      const parts = plan.parts.map((part) => partKey(part)).sort();
      const mirrored = plan.parts.map((part) => partKey(part, true)).sort();
      expect(mirrored, id).toEqual(parts);
      expect(anchorKeys(plan, true), id).toEqual(anchorKeys(plan));
    }
  });

  it('covers Aurelian walking joints without exposed bearings', () => {
    for (const id of AURELIAN_IDS) {
      const exposed = planFor(id).parts.filter(
        (part) => part.shape === 'sphere' || part.shape === 'cylinder',
      );
      expect(exposed, id).toEqual([]);
    }
  });

  it('places an anchor at every location wired to carry a weapon', () => {
    for (const chassis of HULLS) {
      const plan = chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, chassis.id);
      for (const location of LOCATIONS) {
        const hardpoints = chassis.hardpoints[location];
        if (hardpoints.energy + hardpoints.ballistic + hardpoints.missile === 0) continue;
        expect(plan.hardpoints[location], `${chassis.id}.${location}`).toBeDefined();
      }
    }
  });

  it('keeps sealed silhouettes inside their battlefield mesh budgets', () => {
    const budgets = new Map<string, number>([
      ['wisp_wsp1', 26],
      ['votive_vtv2', 28],
      ['sentinel_snl2', 36],
      ['falchion_fal2', 36],
      ['warden_wrd5', 38],
      ['halberd_hlb4', 38],
      ['obsequy_obq3', 40],
      ['pallvault_plv1', 40],
    ]);
    for (const [id, budget] of budgets) {
      expect(planFor(id).parts.length, id).toBeLessThanOrEqual(budget);
    }
  });

  it('reserves transverse armour for the opening silhouettes that earn it', () => {
    const minimumShells = new Map([
      ['sentinel_snl2', 5],
      ['bulwark_bwk3', 5],
      ['cairn_crn3', 4],
      ['hornet_hnt2', 4],
    ]);
    for (const [id, minimum] of minimumShells) {
      const baseline = planFor(id, null);
      const identified = planFor(id);
      expect(baseline.parts.every((part) => part.transverse === undefined), id).toBe(true);
      expect(identified.parts.filter((part) => part.transverse !== undefined).length, id)
        .toBeGreaterThanOrEqual(minimum);
    }
  });

  it('keeps the Sentinel broad and the Falchion long', () => {
    const sentinel = planFor('sentinel_snl2');
    const falchion = planFor('falchion_fal2');
    const sentinelChest = sentinel.parts.find(
      (part) => part.location === 'centre_torso' && part.transverse !== undefined,
    );
    const falchionChest = falchion.parts.find(
      (part) => part.location === 'centre_torso' && part.transverse !== undefined,
    );
    const sentinelArm = sentinel.parts.find(
      (part) => part.location === 'left_arm' && part.transverse !== undefined,
    );
    const falchionArm = falchion.parts.find(
      (part) => part.location === 'left_arm' && part.transverse !== undefined,
    );
    expect(sentinelChest?.size[2] ?? 0).toBeGreaterThan(falchionChest?.size[2] ?? 0);
    expect(falchionArm?.size[1] ?? 0).toBeGreaterThan(sentinelArm?.size[1] ?? 0);
  });

  it('separates the Bulwark shield from the Cairn launcher towers', () => {
    const bulwark = planFor('bulwark_bwk3');
    const cairn = planFor('cairn_crn3');
    const shield = bulwark.parts.find(
      (part) => part.location === 'left_arm' && part.tone === 'trim' && part.size[1] > 0.85,
    );
    expect(shield).toBeDefined();
    expect(shield?.size[0]).toBeGreaterThan(0.9);
    expect(shield?.size[1]).toBeGreaterThan(1);
    expect(cairn.parts.some((part) => part.location === 'left_arm' && part.tone === 'trim')).toBe(false);
    for (const location of ['left_torso', 'right_torso'] as const) {
      const tower = cairn.parts.find(
        (part) => part.location === location && part.tone === 'plate' && part.size[1] > 1,
      );
      expect(tower).toBeDefined();
      expect(Math.abs(tower?.at[2] ?? 0)).toBeGreaterThan(1.1);
    }
  });

  it('gives the Gadfly a long nose, wide engine deck and forward knees', () => {
    const anonymous = planFor('hornet_hnt2', null);
    const gadfly = planFor('hornet_hnt2');
    expect(gadfly.parts.some(
      (part) => part.location === 'head' && part.size[0] >= 0.75 && part.at[0] > 0.7,
    )).toBe(true);
    expect(gadfly.parts.some(
      (part) => part.location === 'centre_torso' && part.tone === 'deep' && part.size[2] > 0.7,
    )).toBe(true);
    expect(gadfly.legs.kneeForward).toBeGreaterThan(anonymous.legs.kneeForward * 1.25);
    expect(gadfly.legs.reach).toBeGreaterThan(gadfly.legs.stanceReach * 1.15);
  });
});
