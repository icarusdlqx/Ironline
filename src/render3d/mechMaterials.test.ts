import { describe, expect, it } from 'vitest';
import { TEAM_COLOURS } from '../render/palette';
import {
  chassisBodyColour,
  createMechMaterials,
  createWeaponMaterial,
} from './mechMaterials';

const CHASSIS_IDS = [
  'bulwark_bwk3',
  'cairn_crn3',
  'colossus_cls1',
  'courser_crs1',
  'drover_dvr2',
  'falchion_fal2',
  'halberd_hlb4',
  'hornet_hnt2',
  'rampart_rmp4',
  'redoubt_rdt1',
  'sentinel_snl2',
  'warden_wrd5',
  'wisp_wsp1',
] as const;

describe('mech materials', () => {
  it('gives every chassis a stable industrial finish', () => {
    const finishes = CHASSIS_IDS.map((id) => chassisBodyColour(id));

    expect(new Set(finishes).size).toBe(CHASSIS_IDS.length);
    expect(chassisBodyColour('future_chassis')).toBe(chassisBodyColour('future_chassis'));
  });

  it('keeps team paint off the main armour', () => {
    const blue = createMechMaterials('sentinel_snl2', TEAM_COLOURS[0] ?? 0, false);
    const orange = createMechMaterials('sentinel_snl2', TEAM_COLOURS[1] ?? 0, false);

    expect(blue.plate.color.getHex()).toBe(orange.plate.color.getHex());
    expect(blue.deep.color.getHex()).not.toBe(orange.deep.color.getHex());
    expect(blue.trim.color.getHex()).toBe(TEAM_COLOURS[0]);
    expect(orange.trim.color.getHex()).toBe(TEAM_COLOURS[1]);
    expect(blue.plate.metalness).toBeLessThan(blue.deep.metalness);
  });

  it('lights intact glass but leaves a wreck dark', () => {
    const intact = createMechMaterials('hornet_hnt2', TEAM_COLOURS[0] ?? 0, false);
    const wreck = createMechMaterials('hornet_hnt2', TEAM_COLOURS[0] ?? 0, true);

    expect(intact.glass.emissive.getHex()).not.toBe(0);
    expect(intact.glass.emissiveIntensity).toBeGreaterThan(1);
    expect(wreck.glass.emissive.getHex()).toBe(0);
    expect(wreck.glass.emissiveIntensity).toBe(0);
  });

  it('separates weapon metal from painted armour', () => {
    const armour = createMechMaterials('cairn_crn3', TEAM_COLOURS[0] ?? 0, false);
    const weapon = createWeaponMaterial('ballistic');

    expect(weapon.metalness).toBeGreaterThan(armour.plate.metalness);
    expect(weapon.color.getHex()).not.toBe(armour.plate.color.getHex());
  });
});
