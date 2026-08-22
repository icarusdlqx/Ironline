export const TRAINING_MISSION_ID = 'training_ground';
export const STANDARD_MISSION_ID = 'skirmish_ridge';

export type TrainingStep = 0 | 1 | 2 | 3 | 4;
type TrainingStatus = 'active' | 'complete' | 'skipped';

interface TrainingRecord {
  version: 1;
  step: TrainingStep;
  status: TrainingStatus;
}

export interface TrainingSignals {
  selected: boolean;
  moved: boolean;
  engaged: boolean;
  heated: boolean;
}

const TRAINING_KEY = 'ironline.training';
const PROFILE_MARKER_EXCLUSIONS = new Set([TRAINING_KEY, 'ironline.playtest.v1']);

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isStep(value: unknown): value is TrainingStep {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4;
}

export function readTraining(): TrainingRecord | null {
  try {
    const raw = storage()?.getItem(TRAINING_KEY);
    if (raw === null || raw === undefined) return null;
    const record = JSON.parse(raw) as Partial<TrainingRecord>;
    if (
      record.version !== 1 ||
      !isStep(record.step) ||
      !['active', 'complete', 'skipped'].includes(record.status ?? '')
    ) {
      return null;
    }
    return record as TrainingRecord;
  } catch {
    return null;
  }
}

function writeTraining(step: TrainingStep, status: TrainingStatus): void {
  try {
    storage()?.setItem(TRAINING_KEY, JSON.stringify({ version: 1, step, status }));
  } catch {
    // Private browsing keeps the lesson for this page only.
  }
}

function hasExperiencedProfile(store: Storage): boolean {
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (
      key?.startsWith('ironline.') === true &&
      !PROFILE_MARKER_EXCLUSIONS.has(key)
    ) {
      return true;
    }
  }
  return false;
}

export function initialSkirmishMission(): string {
  const record = readTraining();
  if (record?.status === 'active') return TRAINING_MISSION_ID;
  if (record?.status === 'complete' || record?.status === 'skipped') return STANDARD_MISSION_ID;

  const store = storage();
  if (store !== null) {
    try {
      if (hasExperiencedProfile(store)) return STANDARD_MISSION_ID;
    } catch {
      return STANDARD_MISSION_ID;
    }
  }
  return TRAINING_MISSION_ID;
}

export function trainingStartStep(): TrainingStep {
  const record = readTraining();
  return record?.status === 'active' ? record.step : 0;
}

export function startTraining(): void {
  if (readTraining()?.status === 'active') return;
  writeTraining(0, 'active');
}

export function storeTrainingStep(step: TrainingStep): void {
  writeTraining(step, 'active');
}

export function skipTraining(): void {
  const record = readTraining();
  if (record?.status === 'complete') return;
  writeTraining(record?.step ?? 0, 'skipped');
}

export function completeTraining(): void {
  writeTraining(4, 'complete');
}

export function advanceTrainingStep(
  current: TrainingStep,
  signals: TrainingSignals,
): TrainingStep {
  let next = current;
  if (next === 0 && signals.selected) next = 1;
  if (next === 1 && signals.moved) next = 2;
  if (next === 2 && signals.engaged) next = 3;
  if (next === 3 && signals.heated) next = 4;
  return next;
}
