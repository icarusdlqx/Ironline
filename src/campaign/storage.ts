export type CampaignStorageIssue =
  | 'invalid-save'
  | 'storage-unavailable'
  | 'write-failed'
  | 'remove-failed';

export interface CampaignPersistenceState {
  mode: 'persistent' | 'memory-only';
  issue: CampaignStorageIssue | null;
  detail: string | null;
  recoveryRaw: string | null;
}

export interface CampaignPersistenceResult {
  ok: boolean;
  error: string | null;
  status: CampaignPersistenceState;
}

export interface CampaignWriteOptions {
  recover?: boolean;
}

export type CampaignStorageRead =
  | { kind: 'found'; text: string; origin: 'memory' | 'storage' }
  | { kind: 'missing' }
  | { kind: 'unavailable'; error: string };

const STORAGE_KEY = 'ironline.campaign';
const READY: CampaignPersistenceState = {
  mode: 'persistent',
  issue: null,
  detail: null,
  recoveryRaw: null,
};

let persistence: CampaignPersistenceState = READY;
let memoryText: string | null = null;

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return String(error || 'storage access failed');
}

function memoryOnly(
  issue: CampaignStorageIssue,
  detail: string,
  recoveryRaw = persistence.recoveryRaw,
): CampaignPersistenceState {
  persistence = { mode: 'memory-only', issue, detail, recoveryRaw };
  return persistence;
}

export function campaignPersistenceStatus(): CampaignPersistenceState {
  return { ...persistence };
}

export function markCampaignStorageReady(): CampaignPersistenceState {
  persistence = READY;
  memoryText = null;
  return campaignPersistenceStatus();
}

export function noteMissingCampaign(): CampaignPersistenceState {
  return persistence.mode === 'memory-only'
    ? campaignPersistenceStatus()
    : markCampaignStorageReady();
}

export function holdInvalidCampaign(raw: string, detail: string): CampaignPersistenceState {
  return memoryOnly('invalid-save', detail, raw);
}

export function readCampaignText(storedOnly = false): CampaignStorageRead {
  if (!storedOnly && persistence.mode === 'memory-only' && memoryText !== null) {
    return { kind: 'found', text: memoryText, origin: 'memory' };
  }
  try {
    const storage = globalThis.localStorage;
    if (storage === undefined) throw new Error('local storage is not available');
    const text = storage.getItem(STORAGE_KEY);
    return text === null
      ? { kind: 'missing' }
      : { kind: 'found', text, origin: 'storage' };
  } catch (error) {
    const detail = errorDetail(error);
    memoryOnly('storage-unavailable', detail);
    return { kind: 'unavailable', error: detail };
  }
}

export function writeCampaignText(
  text: string,
  options: CampaignWriteOptions = {},
): CampaignPersistenceResult {
  if (persistence.mode === 'memory-only' && options.recover !== true) {
    memoryText = text;
    return {
      ok: false,
      error: 'campaign storage is locked for recovery',
      status: campaignPersistenceStatus(),
    };
  }

  try {
    const storage = globalThis.localStorage;
    if (storage === undefined) throw new Error('local storage is not available');
    storage.setItem(STORAGE_KEY, text);
    return { ok: true, error: null, status: markCampaignStorageReady() };
  } catch (error) {
    const detail = errorDetail(error);
    memoryText = text;
    return {
      ok: false,
      error: detail,
      status: memoryOnly('write-failed', detail),
    };
  }
}

export function removeCampaignText(
  options: CampaignWriteOptions = {},
): CampaignPersistenceResult {
  if (persistence.mode === 'memory-only' && options.recover !== true) {
    return {
      ok: false,
      error: 'campaign storage is locked for recovery',
      status: campaignPersistenceStatus(),
    };
  }

  try {
    const storage = globalThis.localStorage;
    if (storage === undefined) throw new Error('local storage is not available');
    storage.removeItem(STORAGE_KEY);
    return { ok: true, error: null, status: markCampaignStorageReady() };
  } catch (error) {
    const detail = errorDetail(error);
    return {
      ok: false,
      error: detail,
      status: memoryOnly('remove-failed', detail),
    };
  }
}
