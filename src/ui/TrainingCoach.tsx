import { useEffect, useRef, useState } from 'react';
import { getCatalog } from '../schema/load';
import { useGame, type UnitSnapshot } from './store';
import {
  advanceTrainingStep,
  completeTraining,
  storeTrainingStep,
  trainingStartStep,
  type TrainingSignals,
  type TrainingStep,
} from './trainingProgress';
import { useCompactLayout } from './useCompactLayout';

const LESSONS: Record<TrainingStep, { title: string; instruction: string }> = {
  0: {
    title: '1 · Select',
    instruction: 'Select a mech on the field or in the lance bar. Tab cycles the lance.',
  },
  1: {
    title: '2 · Move',
    instruction: 'Right-click the marked range gate, or tap it on a touchscreen. Orders work while paused.',
  },
  2: {
    title: '3 · Engage',
    instruction: 'Select your lance, then click or tap a contact in the bar to assign a target.',
  },
  3: {
    title: '4 · Read heat',
    instruction: 'Let a mech fire. Watch its heat bar rise; pause or hold fire before shutdown.',
  },
  4: {
    title: 'Range drill',
    instruction: 'Clear the remaining contacts. Pause whenever the situation gets ahead of you.',
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

export function TrainingCoach() {
  const state = useGame();
  const [step, setStep] = useState<TrainingStep>(trainingStartStep);
  const [open, setOpen] = useState(true);
  const compact = useCompactLayout();
  const seen = useRef<TrainingSignals>({
    selected: false,
    moved: false,
    engaged: false,
    heated: false,
  });
  const trainingName = getCatalog().missions.get('training_ground')?.name ?? '';
  const activeMission = state.missionName === trainingName;

  useEffect(() => {
    if (activeMission) storeTrainingStep(step);
  }, [activeMission, step]);

  useEffect(() => {
    if (!activeMission || !state.briefingSeen || state.finished) return;

    const playerUnits = state.units.filter(
      (unit) => unit.team === state.playerTeam && unit.alive,
    );
    const observed = seen.current;
    observed.selected ||= playerUnits.some((unit) => state.selection.includes(unit.id));
    observed.moved ||= playerUnits.some(
      (unit) => unit.hasMoveOrder || unit.motion !== 'stationary',
    );
    observed.engaged ||=
      playerUnits.some((unit) => unit.targetName !== null) || state.enemies.some(damaged);
    observed.heated ||= playerUnits.some((unit) => unit.heat > 0.5);

    const next = advanceTrainingStep(step, observed);
    if (next !== step) setStep(next);
  }, [
    activeMission,
    state.briefingSeen,
    state.enemies,
    state.finished,
    state.playerTeam,
    state.selection,
    state.units,
    step,
  ]);

  useEffect(() => {
    if (activeMission && state.finished && state.missionStatus === 'success') completeTraining();
  }, [activeMission, state.finished, state.missionStatus]);

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
        <p>{lesson.instruction}</p>
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
