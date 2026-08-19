import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { objectiveProgress, ObjectiveList } from './ObjectiveList';

describe('objective progress copy', () => {
  it('keeps sustained objectives honest while the mission clock runs', () => {
    const objective = {
      id: 'keep_switch',
      label: 'Keep the freight switch secure until pickup',
      required: true,
      status: 'active',
      progress: 1,
      sustained: true,
    };

    expect(objectiveProgress(objective)).toBe('holding');
    expect(
      renderToStaticMarkup(createElement(ObjectiveList, { objectives: [objective], zones: [] })),
    ).toContain('holding');
  });

  it('retains measured progress and names a settled failure', () => {
    expect(objectiveProgress({
      id: 'relay',
      label: 'Take the relays',
      required: true,
      status: 'active',
      progress: 0.67,
    })).toBe('67%');
    expect(objectiveProgress({
      id: 'switch',
      label: 'Keep the switch',
      required: true,
      status: 'failed',
      progress: 0,
      sustained: true,
    })).toBe('failed');
  });

  it('names partial destroy-all progress as a count', () => {
    const objective = {
      id: 'opposition',
      label: 'Stop the opposing lance',
      required: true,
      status: 'active',
      progress: 0,
      stopped: { stopped: 3, total: 4 },
    };

    expect(objectiveProgress(objective)).toBe('3/4 stopped');
    expect(
      renderToStaticMarkup(createElement(ObjectiveList, { objectives: [objective], zones: [] })),
    ).toContain('3/4 stopped');
  });
});
