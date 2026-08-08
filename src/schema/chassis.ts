import { z } from 'zod';
import { IdSchema, LOCATIONS, NameSchema, perLocation } from './common';

export const HardpointsSchema = z.strictObject({
  energy: z.number().int().min(0).max(12),
  ballistic: z.number().int().min(0).max(12),
  missile: z.number().int().min(0).max(12),
  slots: z.number().int().min(0).max(24),
});

export type Hardpoints = z.infer<typeof HardpointsSchema>;

export const ChassisClassSchema = z.enum(['light', 'medium', 'heavy', 'assault']);

export const ChassisSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    class: ChassisClassSchema,
    tonnage: z.number().int().min(20).max(100).multipleOf(5),
    baseCost: z.number().int().positive(),
    engineRating: z.number().int().min(50).max(400).multipleOf(5),
    internalHeatSinks: z.number().int().min(0).max(20),
    jumpCapable: z.boolean(),
    hardpoints: perLocation(HardpointsSchema),
    armourMax: perLocation(z.number().int().positive()),
    internals: perLocation(z.number().int().positive()),
    traits: z.array(IdSchema).default([]),
  })
  .superRefine((chassis, ctx) => {
    for (const location of LOCATIONS) {
      const hardpoints = chassis.hardpoints[location];
      const weaponMounts = hardpoints.energy + hardpoints.ballistic + hardpoints.missile;
      if (weaponMounts > hardpoints.slots) {
        ctx.addIssue({
          code: 'custom',
          path: ['hardpoints', location],
          message: `${weaponMounts} weapon mounts cannot fit in ${hardpoints.slots} slots`,
        });
      }
    }

    const duplicateTraits = chassis.traits.filter(
      (trait, index) => chassis.traits.indexOf(trait) !== index,
    );
    if (duplicateTraits.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['traits'],
        message: `duplicate traits: ${[...new Set(duplicateTraits)].join(', ')}`,
      });
    }
  });

export type Chassis = z.infer<typeof ChassisSchema>;
