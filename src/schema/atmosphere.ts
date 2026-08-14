import { z } from 'zod';
import { IdSchema } from './common';

const ColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Where a light stands, relative to the middle of the map. Angles rather than
 * an offset triple because the point of this file is authoring a sun that sits
 * on the horizon at dusk and a moon that sits high at midnight, and nobody can
 * read that off the numbers (-620, 900, -420).
 *
 * Azimuth 0 points along +x and runs toward +z.
 */
const DirectionSchema = z.strictObject({
  azimuthDegrees: z.number().min(-360).max(360),
  elevationDegrees: z.number().min(0).max(90),
  distance: z.number().positive().max(8_000),
});

export type Direction = z.infer<typeof DirectionSchema>;

/**
 * The air and light over a battlefield. Every default here restates the rig
 * that used to be hardcoded in the renderer, so a map that names no atmosphere
 * looks exactly as it did before this file existed.
 */
export const AtmosphereSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(60),
  /** Flat colour behind everything. Not fogged — it is the void, not the air. */
  sky: ColourSchema.default('#0d1013'),
  exposure: z.number().positive().max(4).default(1.05),
  fog: z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('linear'),
        colour: ColourSchema,
        /**
         * Fog must not start nearer than the camera can pull back, or zooming
         * out greys out the player's own lance.
         */
        near: z.number().nonnegative().max(8_000),
        far: z.number().positive().max(12_000),
      }),
      z.strictObject({
        kind: z.literal('exponential'),
        colour: ColourSchema,
        density: z.number().positive().max(0.01),
      }),
    ])
    .default({ kind: 'linear', colour: '#161c1f', near: 1_100, far: 3_000 }),
  sun: z
    .strictObject({
      colour: ColourSchema.default('#fff2e0'),
      intensity: z.number().nonnegative().max(8).default(2.2),
      direction: DirectionSchema.prefault({
        azimuthDegrees: 214.1,
        elevationDegrees: 50.2,
        distance: 1_170.8,
      }),
      /** A moon at a tenth of daylight does not earn a shadow pass. */
      shadows: z.boolean().default(true),
    })
    .prefault({}),
  fill: z
    .strictObject({
      colour: ColourSchema.default('#8fb4d8'),
      intensity: z.number().nonnegative().max(4).default(0.75),
      direction: DirectionSchema.prefault({
        azimuthDegrees: 38.7,
        elevationDegrees: 23,
        distance: 973.7,
      }),
    })
    .prefault({}),
  hemisphere: z
    .strictObject({
      sky: ColourSchema.default('#bcd8f0'),
      ground: ColourSchema.default('#2c3a2a'),
      intensity: z.number().nonnegative().max(4).default(1),
    })
    .prefault({}),
  /**
   * Mixed into the baked terrain and prop colours. Strength 0 is the palette
   * exactly as authored. This is for ash and rime; darkness is the lighting's
   * job, and tinting the ground black only makes it muddy.
   */
  terrainTint: z
    .strictObject({
      colour: ColourSchema.default('#000000'),
      strength: z.number().min(0).max(0.6).default(0),
    })
    .prefault({}),
});

export type Atmosphere = z.infer<typeof AtmosphereSchema>;
