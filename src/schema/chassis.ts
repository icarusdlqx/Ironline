import { z } from 'zod';
import { IdSchema, LOCATIONS, NameSchema, perLocation } from './common';
import { FactionSchema } from './faction';
import { FrameSchema } from './rules';

export const HardpointsSchema = z.strictObject({
  energy: z.number().int().min(0).max(12),
  ballistic: z.number().int().min(0).max(12),
  missile: z.number().int().min(0).max(12),
  slots: z.number().int().min(0).max(24),
  /**
   * The largest weapon size this location's mounts are built for. Tonnage and
   * slots alone would let a scout bolt a gauss rifle to an arm designed for a
   * machine gun, which is the one thing every quartermaster in the setting
   * would tell you is not how any of this works.
   */
  size: z.number().int().min(1).max(4).default(2),
});

export type Hardpoints = z.infer<typeof HardpointsSchema>;

export const ChassisClassSchema = z.enum(['light', 'medium', 'heavy', 'assault']);

export const ChassisSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    faction: FactionSchema,
    /**
     * What kind of machine this is. Absent means a mech, so the hulls that
     * were here before frames existed never had to be told they are mechs.
     */
    frame: FrameSchema.default('mech'),
    class: ChassisClassSchema,
    tonnage: z.number().int().min(20).max(100).multipleOf(5),
    baseCost: z.number().int().positive(),
    engineRating: z.number().int().min(50).max(400).multipleOf(5),
    internalHeatSinks: z.number().int().min(0).max(20),
    jumpCapable: z.boolean(),
    hardpoints: perLocation(HardpointsSchema),
    armourMax: perLocation(z.number().int().positive()),
    internals: perLocation(z.number().int().positive()),
    /** How this chassis is drawn. Shape is content, not code — a new mech ships
     *  with its own outline rather than reusing everyone else's. */
    silhouette: z
      .strictObject({
        form: z.enum([
          'scout',
          'bird',
          'humanoid',
          'brawler',
          'battle',
          'squat',
          'bastion',
          'siege',
          'tracked',
          'wheeled',
          'emplacement',
        ]),
        /** Torso length and width as fractions of the chassis radius. */
        torsoLength: z.number().positive().max(2).default(1),
        torsoWidth: z.number().positive().max(2).default(1),
        /** How far the shoulders sit out from the centreline. */
        shoulder: z.number().nonnegative().max(2).default(1),
        /** Leg length, and stance width at the hips. */
        legLength: z.number().positive().max(2).default(1),
        stance: z.number().positive().max(2).default(1),
      })
      .default({
        form: 'humanoid',
        torsoLength: 1,
        torsoWidth: 1,
        shoulder: 1,
        legLength: 1,
        stance: 1,
      }),
    /** One line for the bay list; the paragraph for the detail panel. */
    summary: z.string().min(1).max(160).default(''),
    lore: z.string().min(1).max(900).default(''),
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
