import { z } from 'zod';
import { DesignSchema } from '../schema/design';
import { IdSchema, perLocation } from '../schema/common';
import type { CampaignState } from './types';

const SAVE_VERSION = 1;
const STORAGE_KEY = 'ironline.campaign';

const LocationConditionSchema = z.strictObject({
  armour: z.number().nonnegative(),
  // Saves written before mechs had a back load with the rear plate stripped;
  // the first trip through the workshop puts it right.
  rearArmour: z.number().nonnegative().default(0),
  internal: z.number().nonnegative(),
  destroyed: z.boolean(),
});

const MechRecordSchema = z.strictObject({
  id: z.string().min(1),
  design: DesignSchema,
  condition: perLocation(LocationConditionSchema),
  status: z.enum(['ready', 'repairing', 'hulk']),
  readyOnDay: z.number().int(),
  rebuildCost: z.number().nonnegative(),
});

const PilotRecordSchema = z.strictObject({
  id: z.string().min(1),
  templateId: IdSchema,
  name: z.string().min(1),
  gunnery: z.number().int().min(1).max(5),
  piloting: z.number().int().min(1).max(5),
  sensors: z.number().int().min(1).max(5),
  xp: z.number().nonnegative(),
  spentXp: z.number().nonnegative(),
  traits: z.array(IdSchema),
  // Saves written before the register carried biographies still load.
  bio: z.string().default(''),
  injuredUntilDay: z.number().int(),
  dead: z.boolean(),
  mechId: z.string().nullable(),
});

const StoreItemSchema = z.strictObject({
  kind: z.enum(['weapon', 'equipment']),
  itemId: IdSchema,
  count: z.number().int().positive(),
});

const ContractSchema = z.strictObject({
  nodeId: IdSchema,
  missionId: IdSchema,
  employer: z.string().min(1),
  payout: z.number().int(),
  salvageShare: z.number().min(0).max(1),
  acceptedOnDay: z.number().int(),
  deadlineDay: z.number().int(),
});

const MissionOutcomeSchema = z.strictObject({
  nodeId: IdSchema,
  missionId: IdSchema,
  won: z.boolean(),
  day: z.number().int(),
  payout: z.number().int(),
  salvagedChassis: z.array(IdSchema),
  salvagedItems: z.array(StoreItemSchema),
  pilotCasualties: z.array(z.string()),
  mechsLost: z.array(z.string()),
  // Saves written before debriefs were recorded load with none.
  pilotReports: z
    .array(
      z.strictObject({
        pilotId: z.string().min(1),
        name: z.string().min(1),
        mech: z.string(),
        kills: z.number().nonnegative(),
        damage: z.number().nonnegative(),
        xp: z.number(),
        promotions: z.array(z.string()),
        fate: z.enum(['returned', 'injured', 'killed']),
      }),
    )
    .default([]),
});

const RngStateSchema = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  z: z.number().int().nonnegative(),
  w: z.number().int().nonnegative(),
});

export const CampaignStateSchema = z.strictObject({
  campaignId: IdSchema,
  seed: z.string(),
  rng: RngStateSchema,
  day: z.number().int().nonnegative(),
  cbills: z.number().int(),
  mechs: z.array(MechRecordSchema),
  pilots: z.array(PilotRecordSchema),
  // Saves written before the commander could hold anyone back load with
  // nobody benched, which is what they meant.
  benched: z.array(z.string()).default([]),
  store: z.array(StoreItemSchema),
  completedNodes: z.array(IdSchema),
  failedNodes: z.array(IdSchema),
  // Saves written before the hiring hall existed have nothing signed at it.
  sideTaken: z.array(IdSchema).default([]),
  contract: ContractSchema.nullable(),
  history: z.array(MissionOutcomeSchema),
  log: z.array(z.strictObject({ day: z.number().int(), text: z.string() })),
  finished: z.boolean(),
  won: z.boolean(),
  nextId: z.number().int().positive(),
});

export const SaveFileSchema = z.strictObject({
  version: z.literal(SAVE_VERSION),
  state: CampaignStateSchema,
});

export type SaveFile = z.infer<typeof SaveFileSchema>;

export function serialiseCampaign(state: CampaignState): string {
  return `${JSON.stringify({ version: SAVE_VERSION, state }, null, 2)}\n`;
}

export interface LoadResult {
  state: CampaignState | null;
  error: string | null;
}

export function deserialiseCampaign(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { state: null, error: `not valid JSON: ${(error as Error).message}` };
  }

  const parsed = SaveFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      state: null,
      error: `${first?.path.map(String).join('.') || '(root)'}: ${first?.message ?? 'invalid save'}`,
    };
  }

  return { state: parsed.data.state as CampaignState, error: null };
}

export function saveCampaign(state: CampaignState): void {
  globalThis.localStorage?.setItem(STORAGE_KEY, serialiseCampaign(state));
}

export function loadCampaign(): LoadResult {
  const text = globalThis.localStorage?.getItem(STORAGE_KEY);
  if (text === null || text === undefined) return { state: null, error: 'no saved campaign' };
  return deserialiseCampaign(text);
}

export function clearSavedCampaign(): void {
  globalThis.localStorage?.removeItem(STORAGE_KEY);
}

export function campaignBlob(state: CampaignState): Blob {
  return new Blob([serialiseCampaign(state)], { type: 'application/json' });
}
