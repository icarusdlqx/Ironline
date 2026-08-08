import { z } from 'zod';
import { IdSchema, MechLocationSchema, NameSchema, perLocation } from './common';

export const WeaponMountSchema = z.strictObject({
  weaponId: IdSchema,
  location: MechLocationSchema,
});

export const AmmoLoadSchema = z.strictObject({
  weaponId: IdSchema,
  location: MechLocationSchema,
  tons: z.number().int().positive().max(10),
});

export const EquipmentFitSchema = z.strictObject({
  equipmentId: IdSchema,
  location: MechLocationSchema,
});

export const DesignSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  chassisId: IdSchema,
  armour: perLocation(z.number().int().nonnegative()),
  heatSinkId: IdSchema,
  heatSinks: z.number().int().min(1).max(40),
  mounts: z.array(WeaponMountSchema).min(1).max(24),
  ammo: z.array(AmmoLoadSchema).max(12).default([]),
  equipment: z.array(EquipmentFitSchema).max(12).default([]),
});

export type Design = z.infer<typeof DesignSchema>;
export type WeaponMountSpec = z.infer<typeof WeaponMountSchema>;
export type AmmoLoadSpec = z.infer<typeof AmmoLoadSchema>;
