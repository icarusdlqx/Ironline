import { useCallback, useEffect, useRef, useState } from 'react';
import { getCatalog } from '../schema/load';
import { usePlaytest } from './playtest';
import { trainingMilestoneEvents } from './playtest/trainingMilestones';
import { useGame, type UnitSnapshot } from './store';
import {
  advanceTrainingStep,
  completeTraining,
  skipTraining,
  storeTrainingStep,
  trainingStartStep,
  type TrainingSignals,
  type TrainingStep,
} from './trainingProgress';
import { setTrainingPresentationStep } from './trainingPresentation';
import { useCompactLayout } from './useCompactLayout';

const LESSONS: Record<TrainingStep, { title: string; instruction: string; touch: string }> = {
  0: {
    title: '1 · Select',
    instruction: 'Select a mech on the field or in the lance bar. Tab cycles the lance.',
    touch: 'Tap a mech on the field or in the lance bar.',
  },
  1: {
    title: '2 · Move',
    instruction: 'Click Move, then the marked range gate. Right-click also moves. Orders work while paused.',
    touch: 'Tap Orders, Move, then the marked range gate. Orders work while paused.',
  },
  2: {
    title: '3 · Engage',
    instruction: 'Select your lance, then click a contact in the contact bar to assign a target.',
    touch: 'Tap Contacts, then tap a contact to assign the target.',
  },
  3: {
    title: '4 · Read heat',
    instruction: 'Click Resume or press Space. Watch heat rise; pause or hold fire before shutdown.',
    touch: 'Tap Resume, then Heat. Pause or hold fire before shutdown.',
  },
  4: {
    title: 'Range drill',
    instruction: 'Clear the remaining contacts. Pause whenever the situation gets ahead of you.',
    touch: 'Clear the remaining contacts. Pause whenever the situation gets ahead of you.',
  },
};

function damaged(unit: UnitSnapshot): boolean {
  return Object.values(unit.locations).some(
    (location) =>
      location.armour < location.armourMax ||
      location.rearArmour < location.rearArmourMax ||
      location.internal < location.internalMax,
  );
}

interface TrainingCoachProps {
  active?: boolean;
  step?: TrainingStep;
  onStep?: (step: TrainingStep) => void;
}

interface TrainingPresentationOptions {
  active: boolean;
  onSkip?: () => void;
  onComplete?: () => void;
  onContinueAnyway?: () => void;
  onFallback: () => void;
}

interface TrainingPresentationState {
  step: TrainingStep;
  presentedStep: TrainingStep | null;
  onStep: (step: TrainingStep) => void;
  skip: () => void;
  complete: () => void;
  continueAnyway: () => void;
}

export function useTrainingPresentation(
  options: TrainingPresentationOptions,
): TrainingPresentationState {
  const [step, setStep] = useState<TrainingStep>(trainingStartStep);
  const { record } = usePlaytest();
  const presentedStep = options.active ? step : null;
  const onStep = useCallback((next: TrainingStep): void => {
    setTrainingPresentationStep(next);
    setStep(next);
  }, []);

  useEffect(() => {
    if (options.active) setStep(trainingStartStep());
  }, [options.active]);

  useEffect(() => {
    setTrainingPresentationStep(presentedStep);
    return () => setTrainingPresentationStep(null);
  }, [presentedStep]);

  const leave = (status: 'complete' | 'skipped', callback?: () => void): void => {
    if (status === 'complete') completeTraining();
    else {
      skipTraining();
      record({ name: 'training_skipped' });
    }
    (callback ?? options.onFallback)();
  };

  return {
    step,
    presentedStep,
    onStep,
    skip: () => leave('skipped', options.onSkip),
    complete: () => leave('complete', options.onComplete),
    continueAnyway: () => leave('skipped', options.onContinueAnyway),
  };
}

export function TrainingCoach({ active, step: controlledStep, onStep }: TrainingCoachProps = {}) {
  const state = useGame();
  const { record } = usePlaytest();
  const [localStep, setLocalStep] = useState<TrainingStep>(trainingStartStep);
  const [open, setOpen] = useState(true);
  const compact = useCompactLayout();
  const seen = useRef<TrainingSignals>({
    selected: false,
    moved: false,
    engaged: false,
    heated: false,
  });
  const trainingName = getCatalog().missions.get('training_ground')?.name ?? '';
  const activeMission = active ?? state.missionName === trainingName;
  const step = controlledStep ?? localStep;

  useEffect(() => {
    if (activeMission) storeTrainingStep(step);
  }, [activeMission, step]);

  useEffect(() => {
    if (!activeMission || !state.briefingSeen || state.finished) return;

    const playerUnits = state.units.filter(
      (unit) => unit.team === state.playerTeam && unit.alive,
    );
    const observed = seen.current;
    const current: TrainingSignals = {
      selected: observed.selected || playerUnits.some((unit) => state.selection.includes(unit.id)),
      moved: observed.moved || playerUnits.some(
        (unit) => unit.hasMoveOrder || unit.motion !== 'stationary',
      ),
      engaged: observed.engaged ||
        playerUnits.some((unit) => unit.targetName !== null) || state.enemies.some(damaged),
      heated: observed.heated || playerUnits.some((unit) => unit.heat > 0.5),
    };
    for (const event of trainingMilestoneEvents(observed, current)) record(event);
    seen.current = current;

    const next = advanceTrainingStep(step, current);
    if (next !== step) {
      if (controlledStep === undefined) setLocalStep(next);
      onStep?.(next);
    }
  }, [
    activeMission,
    state.briefingSeen,
    state.enemies,
    state.finished,
    state.playerTeam,
    state.selection,
    state.units,
    controlledStep,
    onStep,
    record,
    step,
  ]);

  useEffect(() => {
    if (!activeMission || !state.finished || state.missionStatus === 'active') return;
    record({ name: 'training_finished', outcome: state.missionStatus });
    if (state.missionStatus === 'success') completeTraining();
  }, [activeMission, record, state.finished, state.missionStatus]);

  if (!activeMission || !state.briefingSeen || state.finished) return null;
  const lesson = LESSONS[step];
  const progress = (
    <span className="training-progress" aria-label={`Training step ${step + 1} of 5`}>
      {[0, 1, 2, 3, 4].map((index) => (
        <i key={index} className={index <= step ? 'done' : ''} />
      ))}
    </span>
  );

  if (compact) {
    return (
      <details
        className="training-coach mobile-training"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        data-testid="training-coach"
        aria-live="polite"
      >
        <summary>
          Range control <strong>{lesson.title}</strong>
        </summary>
        <p>{lesson.touch}</p>
        {progress}
      </details>
    );
  }

  return (
    <section className="training-coach" data-testid="training-coach" aria-live="polite">
      <span className="training-kicker">Range control</span>
      <strong>{lesson.title}</strong>
      <p>{lesson.instruction}</p>
      {progress}
    </section>
  );
}
