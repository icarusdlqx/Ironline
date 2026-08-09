import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const WeaponTypeSchema = z.enum(['energy', 'ballistic', 'missile']);
export type WeaponType = z.infer<typeof WeaponTypeSchema>;

export const RangeBandsSchema = z
  .strictObject({
    min: z.number().nonnegative(),
    short: z.number().positive(),
    medium: z.number().positive(),
    long: z.number().positive(),
  })
  .superRefine((bands, ctx) => {
    if (!(bands.min < bands.short && bands.short < bands.medium && bands.medium < bands.long)) {
      ctx.addIssue({
        code: 'custom',
        message: `range bands must increase: min < short < medium < long, got ${bands.min}/${bands.short}/${bands.medium}/${bands.long}`,
      });
    }
  });

export const WeaponSchema = z
  .strictObject({
    id: IdSchema,
    name: NameSchema,
    type: WeaponTypeSchema,
    tonnage: z.number().positive().max(30),
    slots: z.number().int().positive().max(24),
    damage: z.number().positive(),
    projectiles: z.number().int().positive(),
    heat: z.number().nonnegative(),
    cooldown: z.number().positive(),
    velocity: z.number().positive().nullable(),
    range: RangeBandsSchema,
    ammoPerTon: z.number().int().positive().nullable(),
    cost: z.number().int().positive(),
    recoil: z.number().min(0).max(1),
    accuracy: z.number().positive().max(2).default(1),
    /**
     * How often a shot that gets through the plate finds something behind it.
     * A gauss slug punches clean through the frame and takes a weapon with it;
     * a laser bores a shallow hole, and a missile mostly rattles the armour it
     * lands on. This is what makes two guns of the same damage feel different.
     */
    criticalChance: z.number().min(0).max(1).default(0.08),
    /** Heat dumped into the target on a hit — the flamer's whole purpose. */
    targetHeat: z.number().nonnegative().default(0),
    /** How the shot looks. A gauss slug and a laser should never be confused. */
    visual: z
      .strictObject({
        style: z.enum(['beam', 'pulse', 'bolt', 'tracer', 'slug', 'missile', 'flame', 'burst']),
        colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        width: z.number().positive().max(12).default(2),
        /** How high a projectile lobs on its way over, in metres. */
        arc: z.number().nonnegative().max(120).default(0),
      })
      .default({ style: 'tracer', colour: '#ffd489', width: 2, arc: 0 }),
    /** What it is for, in the words a quartermaster would use. */
    summary: z.string().min(1).max(200).default(''),
    tags: z.array(IdSchema).default([]),
  })
  .superRefine((weapon, ctx) => {
    if (weapon.type === 'energy') {
      if (weapon.ammoPerTon !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['ammoPerTon'],
          message: 'energy weapons carry no ammo; ammoPerTon must be null',
        });
      }
      if (weapon.velocity !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['velocity'],
          message: 'energy weapons resolve as instant beams; velocity must be null',
        });
      }
      return;
    }

    if (weapon.ammoPerTon === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['ammoPerTon'],
        message: `${weapon.type} weapons are ammo-dependent; ammoPerTon must be a positive integer`,
      });
    }
    if (weapon.velocity === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['velocity'],
        message: `${weapon.type} weapons fire travelling projectiles; velocity must be positive`,
      });
    }
  });

export type Weapon = z.infer<typeof WeaponSchema>;
