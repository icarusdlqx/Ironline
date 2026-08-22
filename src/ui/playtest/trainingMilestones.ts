import type { TrainingSignals } from '../trainingProgress';
import type { FirstRunEventInput } from './schema';

type TrainingMilestoneEvent = Extract<
  FirstRunEventInput,
  {
    name:
      | 'training_selected'
      | 'training_moved'
      | 'training_engaged'
      | 'training_heat_seen';
  }
>;

const MILESTONES = [
  ['selected', 'training_selected'],
  ['moved', 'training_moved'],
  ['engaged', 'training_engaged'],
  ['heated', 'training_heat_seen'],
] as const satisfies readonly (readonly [keyof TrainingSignals, TrainingMilestoneEvent['name']])[];

export function trainingMilestoneEvents(
  previous: TrainingSignals,
  current: TrainingSignals,
): TrainingMilestoneEvent[] {
  return MILESTONES.flatMap(([signal, name]) =>
    !previous[signal] && current[signal] ? [{ name }] : [],
  );
}
