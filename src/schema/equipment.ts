import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const EquipmentCategorySchema = z.enum([
  'heat_sink',
  'jump_jet',
  'electronics',
  'defensive',
  'targeting',
]);

export type EquipmentCategory = z.infer<typeof EquipmentCategorySchema>;

export const EquipmentSchema = z.strictObject({
  id: IdSchema,
  name: NameSchema,
  category: EquipmentCategorySchema,
  tonnage: z.number().nonnegative().max(20),
  slots: z.number().int().nonnegative().max(24),
  cost: z.number().int().nonnegative(),
  stats: z.record(IdSchema, z.number()).default({}),
  tags: z.array(IdSchema).default([]),
});

export type Equipment = z.infer<typeof EquipmentSchema>;
