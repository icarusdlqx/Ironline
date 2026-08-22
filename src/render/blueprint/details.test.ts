import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import type { MechLocation } from '../../schema/common';
import { chassisBlueprint, type Blueprint, type BlueprintPart } from '../blueprint';
import {
  AURELIAN_SIGNATURE_IDS,
  SIGNATURE_CHASSIS_IDS,
} from './details';

const HULLS = [...catalog.chassis.values()];
const SIGNATURE_IDS = new Set<string>(SIGNATURE_CHASSIS_IDS);

const DETAIL_BUDGETS: Record<string, { surface: number; hero: number }> = {
  hornet_hnt2: { surface: 4, hero: 6 },
  drover_dvr2: { surface: 4, hero: 6 },
  bulwark_bwk3: { surface: 4, hero: 6 },
  colossus_cls1: { surface: 4, hero: 6 },
  votive_vtv2: { surface: 4, hero: 6 },
  sentinel_snl2: { surface: 4, hero: 6 },
  halberd_hlb4: { surface: 4, hero: 6 },
  pallvault_plv1: { surface: 4, hero: 8 },
};

// These signatures predate inspection geometry, so any change points back to
// load-bearing plans rather than merely accepting a new mesh count.
const STRUCTURAL_DIGESTS: Record<string, string> = {
  bulwark_bwk3: '42d94f524489315e8fc06e4f771c869b0cbdb97a77b034996576156d2867a408',
  cairn_crn3: 'f7c8aa5c5397c559cf22478bf9c7e4e3969a22736c10bd406218f314b2188e11',
  colossus_cls1: 'd4e967429e3a56421f8706c941b1eb85c6bd384c2d7af2969b4d323ba43552d5',
  courser_crs1: '6d9749a0372967fa3f9edeff60abfc8be5de15cfe4e9cbfbc881e7d3c30bc223',
  drover_dvr2: 'a9410a92262b4741841f0d9735b21515935c4c94e10922f104004dac7398d45e',
  falchion_fal2: 'f16c2bdbe28f9ebb5a4d31f3879839d0fae76322489de49dae5bee4fe9f8f4b7',
  halberd_hlb4: 'a69f79f645f19aae51a56d703388b2ec95918fa712fb1905eb70001b7305cfcf',
  hornet_hnt2: '6dee0e7f7b85fd2767f75a0d40fd2f6eb1e18046d79392206ce30a0776bfc055',
  obsequy_obq3: '87c96538a3b9ffebfeb10dcd29dcc588e2e125dbe6d902b305975a1032cd260c',
  pallvault_plv1: '405bb5174da702940558ceccc26274621a85356607b07268c2ec72257637731a',
  rampart_rmp4: 'df75e2df70c334436f6b2004493c949849ed659b99201337b5f3bf28a1b09ddf',
  redoubt_rdt1: 'd18e3107d8f14bed36c61656e478b11826bcb80e4cfbff66ac47d69995562adf',
  sentinel_snl2: 'a80764d50d9d1712343e3212440e9712519ab37a3d652c9107fc7b4c5615b558',
  votive_vtv2: '5d3d83261c04015074e69d8f0c0d4bdb71e857d372f484dcdeeccec69166a99a',
  warden_wrd5: '3c0a716ccfa1874f471b604d7d5b31ece4bf8b0e73f9e28c65e8d01370ab3b6b',
  wisp_wsp1: 'aabe3487c8a706146840f3dbf02263f2084fa7e806036c58b44fd6ecfd55529e',
};

const MIRRORED_LOCATION: Partial<Record<MechLocation, MechLocation>> = {
  left_arm: 'right_arm',
  right_arm: 'left_arm',
  left_torso: 'right_torso',
  right_torso: 'left_torso',
  left_leg: 'right_leg',
  right_leg: 'left_leg',
};

function planFor(id: string): Blueprint {
  const chassis = catalog.chassis.get(id);
  if (chassis === undefined) throw new Error(`unknown chassis ${id}`);
  return chassisBlueprint(chassis.silhouette, chassis.traits, chassis.hardpoints, id);
}

function structuralDigest(plan: Blueprint): string {
  const structural = {
    ...plan,
    parts: plan.parts.filter((part) => part.detail === 'structure'),
  };
  return createHash('sha256').update(JSON.stringify(canonical(structural))).digest('hex');
}

function canonical(value: unknown): unknown {
  // Libm implementations may differ by an ulp for derived joint lengths.
  // Stable key ordering and ten-decimal rounding keep this structural lock portable.
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    return Object.is(value, -0) ? 0 : Number(value.toFixed(10));
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function detailKey(part: BlueprintPart, mirrored = false): string {
  const location = mirrored && part.location !== null
    ? (MIRRORED_LOCATION[part.location] ?? part.location)
    : part.location;
  const at = mirrored
    ? [part.at[0], part.at[1], cleanZero(-part.at[2])]
    : part.at.map(cleanZero);
  return JSON.stringify([
    location,
    part.shape,
    at,
    part.size,
    part.tone,
    part.detail,
    part.tilt ?? null,
    part.fixed ?? false,
    part.profile ?? null,
    part.transverse ?? null,
  ]);
}

describe('signature chassis detail', () => {
  it('spends the inspection budget on exactly eight signature chassis', () => {
    expect(SIGNATURE_CHASSIS_IDS).toHaveLength(8);
    expect(new Set(SIGNATURE_CHASSIS_IDS).size).toBe(8);

    for (const id of SIGNATURE_CHASSIS_IDS) {
      const details = planFor(id).parts.filter((part) => part.detail !== 'structure');
      const budget = DETAIL_BUDGETS[id];
      expect(budget, id).toBeDefined();
      expect(details.filter((part) => part.detail === 'surface'), id).toHaveLength(budget?.surface ?? 0);
      expect(details.filter((part) => part.detail === 'hero'), id).toHaveLength(budget?.hero ?? 0);
    }
  });

  it('leaves the deferred eight chassis at structural detail only', () => {
    const deferred = HULLS.filter((chassis) => !SIGNATURE_IDS.has(chassis.id));
    expect(deferred).toHaveLength(8);
    for (const chassis of deferred) {
      expect(planFor(chassis.id).parts.every((part) => part.detail === 'structure'), chassis.id)
        .toBe(true);
    }
  });

  it('does not move a structural part, joint, hardpoint or height', () => {
    expect(HULLS).toHaveLength(Object.keys(STRUCTURAL_DIGESTS).length);
    for (const chassis of HULLS) {
      expect(structuralDigest(planFor(chassis.id)), chassis.id)
        .toBe(STRUCTURAL_DIGESTS[chassis.id]);
    }
  });

  it('keeps every Aurelian detail sealed and bilaterally symmetric', () => {
    for (const id of AURELIAN_SIGNATURE_IDS) {
      const details = planFor(id).parts.filter((part) => part.detail !== 'structure');
      const direct = details.map((part) => detailKey(part)).sort();
      const mirrored = details.map((part) => detailKey(part, true)).sort();
      expect(mirrored, id).toEqual(direct);
      expect(details.every((part) => part.shape === 'box'), id).toBe(true);
    }
  });

  it('keeps inspection pieces outside walking pivots', () => {
    for (const chassis of HULLS.filter((entry) => entry.frame === 'mech')) {
      const details = planFor(chassis.id).parts.filter((part) => part.detail !== 'structure');
      expect(details.every((part) => part.joint === undefined), chassis.id).toBe(true);
      expect(details.every(
        (part) => part.location !== 'left_leg' && part.location !== 'right_leg',
      ), chassis.id).toBe(true);
    }
  });
});
