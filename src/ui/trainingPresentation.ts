import type { TrainingStep } from './trainingProgress';

export function battleStartsPaused(campaignPending: boolean, missionId: string): boolean {
  return !campaignPending && missionId === 'training_ground';
}

const COMMAND_IDS: Record<TrainingStep, ReadonlySet<string>> = {
  0: new Set(),
  1: new Set(['move']),
  2: new Set(['move', 'attack']),
  3: new Set(['move', 'attack', 'hold_fire', 'heat_safety']),
  4: new Set(),
};

const ALWAYS_AVAILABLE_SHORTCUTS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Escape',
  'KeyE',
  'Space',
  'Tab',
]);

const SHORTCUTS_BY_STEP: Record<TrainingStep, ReadonlySet<string>> = {
  0: new Set(),
  1: new Set(['KeyM']),
  2: new Set(['KeyF', 'KeyM', 'KeyQ']),
  3: new Set(['KeyF', 'KeyH', 'KeyM', 'KeyQ', 'KeyT']),
  4: new Set(),
};

let activeStep: TrainingStep | null = null;

export function setTrainingPresentationStep(step: TrainingStep | null): void {
  activeStep = step;
}

export function currentTrainingPresentationStep(): TrainingStep | null {
  return activeStep;
}

export function trainingCommandIds(step: TrainingStep | null): ReadonlySet<string> | null {
  return step === null || step === 4 ? null : COMMAND_IDS[step];
}

export function trainingShowsFullHud(step: TrainingStep | null): boolean {
  return step === null || step === 4;
}

export function trainingShowsContacts(step: TrainingStep | null): boolean {
  return step === null || step >= 2;
}

export function trainingShowsHeatReadout(step: TrainingStep | null): boolean {
  return step === 3;
}

export function trainingShortcutAllowed(step: TrainingStep | null, code: string): boolean {
  if (step === null || step === 4) return true;
  return ALWAYS_AVAILABLE_SHORTCUTS.has(code) || SHORTCUTS_BY_STEP[step].has(code);
}
