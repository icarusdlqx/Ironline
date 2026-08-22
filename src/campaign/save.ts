import { getCatalog, type Catalog } from '../schema/load';
import type { Campaign } from '../schema/campaign';
import {
  canonicalEmployer,
  employerById,
  legacyEmployer,
  UNKNOWN_EMPLOYER_ID,
  UNKNOWN_EMPLOYER_NAME,
  type EmployerIdentity,
} from './employers';
import { pruneSideOffers, sideEmployerIdFor } from './sidework';
import { pruneCampaignHistory } from './history';
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
import { CampaignStateSchema, SAVE_VERSION, SaveFileSchema } from './saveSchema';
import { coalesceMigratedWeaponItems, migrateWeaponSave } from './weaponSaveMigration';

export { CampaignStateSchema, SaveFileSchema };
export type { SaveFile } from './saveSchema';

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

  const parsed = SaveFileSchema.safeParse(
    migrateWeaponSave(migrateEmployerSave(raw, catalog)),
  );
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      state: null,
      error: `${first?.path.map(String).join('.') || '(root)'}: ${first?.message ?? 'invalid save'}`,
    };
  }

  const state = parsed.data.state as CampaignState;
  coalesceMigratedWeaponItems(state);
  pruneSideOffers(catalog, state);
  pruneCampaignHistory(catalog, state);
  return { state, error: null };
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
