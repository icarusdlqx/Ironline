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
  bulwark_bwk3: '063f398bcfe5b27f5215b807631e558fedea3a9e5541bbf836c7edd19815b368',
  cairn_crn3: 'daab51ffac2ac334057676221d66e97974e386fed3f115063711dde8f30a7772',
  colossus_cls1: 'ddee8c5adcf4933e5876bba4150e8fa26bef8e82d5eecde6c0bff17c9cd102f5',
  courser_crs1: 'a45ec68eb0d4a6099c1029a972f53b3e7d8edfa36dee328e20e81242e6083556',
  drover_dvr2: 'de24b7a42837a88b29456953b5acb58e6f2fa03767b03871c58240443ceac641',
  falchion_fal2: 'ed378ea5bd222abd45c0337d98bedd9016208d9989dcaae2bf214296c121f857',
  halberd_hlb4: '568d6e9a20528da5fe2936eb859f5acdd4786380bc511d65746be4e9746a3300',
  hornet_hnt2: '199f53970b31627697952ac56804b38d84186974f9e117b348ca46b393de344d',
  obsequy_obq3: 'c0ea1e0ee5ce70f3f24772d5f8e8003b57320979f5775f17346daa18e6fe364b',
  pallvault_plv1: 'd47fcbd0942c63f71e50f56d9dc422f98a40c72bfe20301fc17d8b3f9ef674f8',
  rampart_rmp4: '150af3d4fffb72c116988e8b7adefdc87737f91fef8c5f253f1d0af285f7128f',
  redoubt_rdt1: '1901b83565f26de604120b14ae579cb76ef37999874972fcea1b0a16a98a6b33',
  sentinel_snl2: '3f950041612c4a87d43f59e2fc757e7f3c700de7db8a0a5ef2fa6f4878546cbf',
  votive_vtv2: '08e86fee48d0ebfbba8d02d1e86aafffde24c3c3494894d7ccd71c40f3d51ee4',
  warden_wrd5: '9080e658924da4af14b33a82ff3051ced4ddf63c89ace130fc590d191011a998',
  wisp_wsp1: '0cf6a4058197ec7751abd32683c7ba44479ce2273ff1fe53ca9d97938d78993e',
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
  return createHash('sha256').update(JSON.stringify(structural)).digest('hex');
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
