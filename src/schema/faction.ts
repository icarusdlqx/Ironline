import { z } from 'zod';

export const FactionSchema = z.enum(['linewrought', 'aurelian']);

export type Faction = z.infer<typeof FactionSchema>;
