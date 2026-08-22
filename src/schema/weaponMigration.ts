type JsonObject = Record<string, unknown>;

/**
 * Public saves outlive a catalogue pass. Keep retired ids readable here rather
 * than retaining dead shelf entries or teaching every consumer about aliases.
 */
export const WEAPON_ID_ALIASES = {
  er_small_laser: 'small_laser',
  ac2: 'machine_gun',
  ac10: 'lbx_ac10',
  heavy_gauss: 'gauss_rifle',
  inferno_srm4: 'srm2',
  lbx_ac20: 'ac20',
  light_gauss: 'ac5',
  lrm5: 'srm2',
  lrm15: 'lrm10',
  mrm30: 'mrm20',
  mrm40: 'mrm20',
  rotary_ac2: 'ac5',
  srm4: 'srm2',
  streak_srm2: 'srm2',
  streak_srm4: 'srm2',
  thunderbolt15: 'lrm10',
  ultra_ac5: 'ac5',
} as const satisfies Readonly<Record<string, string>>;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function canonicalWeaponId(id: string): string {
  return WEAPON_ID_ALIASES[id as keyof typeof WEAPON_ID_ALIASES] ?? id;
}

function migrateWeaponReference(value: unknown): unknown {
  const record = object(value);
  if (record === null || typeof record.weaponId !== 'string') return value;
  return { ...record, weaponId: canonicalWeaponId(record.weaponId) };
}

/** Rewrites only weapon-bearing design fields and leaves malformed input for Zod to reject. */
export function migrateDesignWeaponIds(value: unknown): unknown {
  const design = object(value);
  if (design === null) return value;

  const mounts = Array.isArray(design.mounts)
    ? design.mounts.map(migrateWeaponReference)
    : design.mounts;
  const ammo = Array.isArray(design.ammo)
    ? design.ammo.map(migrateWeaponReference)
    : design.ammo;

  return { ...design, mounts, ammo };
}
