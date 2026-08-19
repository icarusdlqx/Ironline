import { z } from 'zod';
import { DesignSchema, WeaponMountSchema } from '../schema/design';
import { IdSchema, MechLocationSchema, perLocation } from '../schema/common';
import { getCatalog, type Catalog } from '../schema/load';
import type { Campaign } from '../schema/campaign';
import {
  canonicalEmployer,
  EMPLOYER_FAILURE_LIMIT,
  employerById,
  legacyEmployer,
  UNKNOWN_EMPLOYER_ID,
  UNKNOWN_EMPLOYER_NAME,
  type EmployerIdentity,
} from './employers';
import { sideEmployerIdFor } from './sidework';
import {
  campaignPersistenceStatus,
  holdInvalidCampaign,
  markCampaignStorageReady,
  noteMissingCampaign,
  readCampaignText,
  removeCampaignText,
  writeCampaignText,
  type CampaignPersistenceResult,
  type CampaignPersistenceState,
  type CampaignWriteOptions,
} from './storage';
import type { CampaignState } from './types';

const SAVE_VERSION = 1;

const LocationConditionSchema = z.strictObject({
  armour: z.number().nonnegative(),
  // Saves written before mechs had a back load with the rear plate stripped;
  // the first trip through the workshop puts it right.
  rearArmour: z.number().nonnegative().default(0),
  internal: z.number().nonnegative(),
  destroyed: z.boolean(),
});

// Catalogue designs always carry a weapon. A recovered campaign hull is a
// different state: it may be stored, rebuilt and saved before the company fits
// its first gun. Keep that exception local to campaign persistence rather than
// weakening authored-design validation.
const StoredDesignSchema = DesignSchema.extend({
  mounts: z.array(WeaponMountSchema).max(24),
});

const MechRecordSchema = z.strictObject({
  id: z.string().min(1),
  design: StoredDesignSchema,
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

const SalvageOutcomeSchema = z.enum([
  'centre_torso',
  'head',
  'ammo_explosion',
  'legged',
  'ejected',
]);

const SalvageCandidateSchema = z.strictObject({
  designId: IdSchema,
  name: z.string().min(1),
  outcome: SalvageOutcomeSchema,
  chassisChance: z.number().min(0).max(1),
  recovered: z.boolean(),
});

const SalvageProvenanceSchema = z.strictObject({
  kind: z.enum(['weapon', 'equipment']),
  itemId: IdSchema,
  sourceDesignId: IdSchema,
  sourceMechName: z.string().min(1),
  location: MechLocationSchema,
});

const ContractTermsSchema = z.enum(['fee_first', 'standard', 'salvage_first']);

const ContractSchema = z.strictObject({
  nodeId: IdSchema,
  missionId: IdSchema,
  employerId: IdSchema,
  employerName: z.string().min(1),
  // Old contracts load on the middle terms; their stored payout and salvage
  // still remain authoritative.
  termsId: ContractTermsSchema.default('standard'),
  payout: z.number().int(),
  salvageShare: z.number().min(0).max(1),
  acceptedOnDay: z.number().int(),
  deadlineDay: z.number().int(),
});

const MissionOutcomeSchema = z.strictObject({
  nodeId: IdSchema,
  missionId: IdSchema,
  employerId: IdSchema,
  employerName: z.string().min(1),
  // Old debriefs predate named packages but already carry the exact proceeds.
  termsId: ContractTermsSchema.default('standard'),
  won: z.boolean(),
  day: z.number().int(),
  payout: z.number().int(),
  salvagedChassis: z.array(IdSchema),
  salvagedItems: z.array(StoreItemSchema),
  /** Older saves predate the salvage choice and simply offered nothing. */
  salvageOffered: z.array(StoreItemSchema).default([]),
  // A missing ledger means the old debrief never recorded the field rolls.
  salvageCandidates: z.array(SalvageCandidateSchema).default([]),
  salvageProvenance: z.array(SalvageProvenanceSchema).default([]),
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
        // Older debriefs did not snapshot the pilot's bank after a drop.
        xpBanked: z.number().nonnegative().nullable().default(null),
        promotions: z.array(z.string()),
        fate: z.enum(['returned', 'injured', 'killed']),
      }),
    )
    .default([]),
});

const EmployerFailureSchema = z.strictObject({
  employerId: IdSchema,
  employerName: z.string().min(1),
  day: z.number().int().nonnegative(),
  reason: z.enum(['withdrawn', 'expired']),
  count: z.number().int().positive().default(1),
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
  // Saves written before the yard existed have bought nothing from it.
  marketBought: z.array(IdSchema).default([]),
  contract: ContractSchema.nullable(),
  history: z.array(MissionOutcomeSchema),
  employerFailures: z.array(EmployerFailureSchema).max(EMPLOYER_FAILURE_LIMIT).default([]),
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

export interface CampaignParseResult {
  state: CampaignState | null;
  error: string | null;
}

export interface LoadResult extends CampaignParseResult {
  source: 'loaded' | 'memory' | 'missing' | 'invalid' | 'unavailable';
  raw: string | null;
  persistence: CampaignPersistenceState;
}

export interface CampaignLoadOptions {
  storedOnly?: boolean;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function inferredEmployer(
  campaign: Campaign | undefined,
  record: JsonObject,
  recoveredEmployerId: string | null,
): EmployerIdentity {
  const legacyName = typeof record.employer === 'string' ? record.employer : null;
  if (legacyName !== null && campaign !== undefined) return canonicalEmployer(campaign, legacyName);
  if (legacyName !== null) return legacyEmployer(legacyName);

  const employerId = typeof record.employerId === 'string' ? record.employerId : null;
  if (employerId !== null && campaign !== undefined) return employerById(campaign, employerId);

  const nodeId = typeof record.nodeId === 'string' ? record.nodeId : null;
  const node = campaign?.nodes.find((entry) => entry.id === nodeId);
  if (node !== undefined && campaign !== undefined) return employerById(campaign, node.employerId);
  if (recoveredEmployerId !== null && campaign !== undefined) {
    return employerById(campaign, recoveredEmployerId);
  }

  return { id: employerId ?? UNKNOWN_EMPLOYER_ID, name: UNKNOWN_EMPLOYER_NAME };
}

function migrateRecord(
  campaign: Campaign | undefined,
  value: unknown,
  recoveredEmployerId: string | null,
): unknown {
  const record = object(value);
  if (record === null) return value;
  if (
    typeof record.employerId === 'string' &&
    typeof record.employerName === 'string' &&
    record.employer === undefined
  ) {
    return value;
  }

  const identity =
    typeof record.employerId === 'string' && typeof record.employerName === 'string'
      ? { id: record.employerId, name: record.employerName }
      : inferredEmployer(campaign, record, recoveredEmployerId);
  const migrated: JsonObject = {
    ...record,
    employerId: identity.id,
    employerName: identity.name,
  };
  delete migrated.employer;
  return migrated;
}

export function migrateEmployerSave(raw: unknown, catalog: Catalog): unknown {
  const save = object(raw);
  const state = object(save?.state);
  if (save === null || state === null) return raw;

  const campaign =
    typeof state.campaignId === 'string' ? catalog.campaigns.get(state.campaignId) : undefined;
  const recoveredEmployer = (value: unknown): string | null => {
    const record = object(value);
    if (
      record === null ||
      typeof state.campaignId !== 'string' ||
      typeof state.seed !== 'string' ||
      typeof record.nodeId !== 'string' ||
      typeof record.missionId !== 'string'
    ) {
      return null;
    }
    return sideEmployerIdFor(
      catalog,
      state.campaignId,
      state.seed,
      record.nodeId,
      record.missionId,
    );
  };
  const contract =
    state.contract === null
      ? null
      : migrateRecord(campaign, state.contract, recoveredEmployer(state.contract));
  const history = Array.isArray(state.history)
    ? state.history.map((record) =>
        migrateRecord(campaign, record, recoveredEmployer(record)),
      )
    : state.history;
  return { ...save, state: { ...state, contract, history } };
}

export function deserialiseCampaign(text: string, catalog: Catalog = getCatalog()): CampaignParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { state: null, error: `not valid JSON: ${(error as Error).message}` };
  }

  const parsed = SaveFileSchema.safeParse(migrateEmployerSave(raw, catalog));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      state: null,
      error: `${first?.path.map(String).join('.') || '(root)'}: ${first?.message ?? 'invalid save'}`,
    };
  }

  return { state: parsed.data.state as CampaignState, error: null };
}

export function saveCampaign(state: CampaignState, options: CampaignWriteOptions = {}): CampaignPersistenceResult {
  return writeCampaignText(serialiseCampaign(state), options);
}

export function loadCampaign(catalog: Catalog = getCatalog(), options: CampaignLoadOptions = {}): LoadResult {
  const stored = readCampaignText(options.storedOnly === true);
  if (stored.kind === 'unavailable') {
    return {
      state: null,
      error: `campaign storage unavailable: ${stored.error}`,
      source: 'unavailable',
      raw: null,
      persistence: campaignPersistenceStatus(),
    };
  }
  if (stored.kind === 'missing') {
    return {
      state: null,
      error: 'no saved campaign',
      source: 'missing',
      raw: null,
      persistence: noteMissingCampaign(),
    };
  }

  const parsed = deserialiseCampaign(stored.text, catalog);
  if (parsed.state === null) {
    return {
      ...parsed,
      source: 'invalid',
      raw: stored.text,
      persistence: holdInvalidCampaign(stored.text, parsed.error ?? 'invalid save'),
    };
  }
  return {
    ...parsed,
    source: stored.origin === 'memory' ? 'memory' : 'loaded',
    raw: stored.text,
    persistence:
      stored.origin === 'memory' ? campaignPersistenceStatus() : markCampaignStorageReady(),
  };
}

export function clearSavedCampaign(options: CampaignWriteOptions = {}): CampaignPersistenceResult {
  return removeCampaignText(options);
}

export function campaignBlob(state: CampaignState): Blob {
  return new Blob([serialiseCampaign(state)], { type: 'application/json' });
}

export function rawCampaignBlob(raw: string): Blob {
  return new Blob([raw], { type: 'text/plain' });
}

export { campaignPersistenceStatus } from './storage';
export type { CampaignPersistenceResult, CampaignPersistenceState, CampaignStorageIssue, CampaignWriteOptions } from './storage';
