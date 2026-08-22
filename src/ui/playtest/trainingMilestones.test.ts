import { describe, expect, it } from 'vitest';
import type { TrainingSignals } from '../trainingProgress';
import { trainingMilestoneEvents } from './trainingMilestones';

const NONE: TrainingSignals = {
  selected: false,
  moved: false,
  engaged: false,
  heated: false,
};

describe('training playtest milestones', () => {
  it('reports only newly reached, approved milestones in lesson order', () => {
    expect(
      trainingMilestoneEvents(NONE, {
        selected: true,
        moved: true,
        engaged: false,
        heated: true,
      }),
    ).toEqual([
      { name: 'training_selected' },
      { name: 'training_moved' },
      { name: 'training_heat_seen' },
    ]);
  });

  it('does not report a milestone that was already observed', () => {
    expect(
      trainingMilestoneEvents(
        { ...NONE, selected: true, moved: true },
        { selected: true, moved: true, engaged: true, heated: false },
      ),
    ).toEqual([{ name: 'training_engaged' }]);
  });
});
