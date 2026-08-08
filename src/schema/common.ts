import { z } from 'zod';

export const LOCATIONS = [
  'head',
  'centre_torso',
  'left_torso',
  'right_torso',
  'left_arm',
  'right_arm',
  'left_leg',
  'right_leg',
] as const;

export type MechLocation = (typeof LOCATIONS)[number];

export const MechLocationSchema = z.enum(LOCATIONS);

export const IdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'ids are lower_snake_case and start with a letter');

export const NameSchema = z.string().min(1).max(64);

export function perLocation<T extends z.ZodType>(value: T) {
  return z.strictObject({
    head: value,
    centre_torso: value,
    left_torso: value,
    right_torso: value,
    left_arm: value,
    right_arm: value,
    left_leg: value,
    right_leg: value,
  });
}
