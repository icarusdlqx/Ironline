import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

/** A page of setting material, shown in the field manual and on the campaign screen. */
export const LoreEntrySchema = z.strictObject({
  id: IdSchema,
  title: NameSchema,
  /** Where it sits in the manual; lower sorts first. */
  order: z.number().int().min(0).max(99),
  /** Field discoveries stay hidden so the manual cannot spoil the campaign reveal. */
  unlockNodeId: IdSchema.optional(),
  /** One line, used as the summary wherever there is no room for the whole page. */
  summary: z.string().min(1).max(240),
  body: z.array(z.string().min(1).max(1200)).min(1).max(12),
});

export type LoreEntry = z.infer<typeof LoreEntrySchema>;
