import { aurelianSignatureDetails } from './details-aurelian';
import { lineSignatureDetails } from './details-line';
import type { BlueprintPart, Bones } from './types';

export const LINE_SIGNATURE_IDS = [
  'hornet_hnt2',
  'drover_dvr2',
  'bulwark_bwk3',
  'colossus_cls1',
] as const;

export const AURELIAN_SIGNATURE_IDS = [
  'votive_vtv2',
  'sentinel_snl2',
  'halberd_hlb4',
  'pallvault_plv1',
] as const;

export const SIGNATURE_CHASSIS_IDS = [
  ...LINE_SIGNATURE_IDS,
  ...AURELIAN_SIGNATURE_IDS,
] as const;

export function signatureDetails(identity: string | null, b: Bones): BlueprintPart[] {
  if (identity === null) return [];
  return lineSignatureDetails(identity, b) ?? aurelianSignatureDetails(identity, b) ?? [];
}
