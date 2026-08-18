import { useState } from 'react';
import type { ObjectiveView, ZoneView } from './store';
import { useCompactLayout } from './useCompactLayout';

interface ObjectiveListProps {
  objectives: readonly ObjectiveView[];
  zones: readonly ZoneView[];
}

export function objectiveProgress(objective: ObjectiveView): string {
  if (objective.status === 'failed') return 'failed';
  if (objective.sustained === true && objective.status === 'active') return 'holding';
  return `${String(Math.round(objective.progress * 100))}%`;
}

function ObjectiveBody({ objectives, zones }: ObjectiveListProps) {
  return (
    <div className="objective-body">
      <h4>Objectives</h4>
      <ul>
        {objectives.map((objective) => (
          <li key={objective.id} className={objective.status} data-testid={`objective-${objective.id}`}>
            <span className="objective-mark">
              {objective.status === 'complete' ? '✓' : objective.status === 'failed' ? '✗' : '•'}
            </span>
            <span className="objective-label">
              {objective.label}
              {objective.required ? '' : ' (optional)'}
            </span>
            <span className="objective-progress">{objectiveProgress(objective)}</span>
          </li>
        ))}
      </ul>
      {zones.length === 0 ? null : (
        <ul className="zones" data-testid="zone-list">
          {zones.map((zone) => (
            <li key={zone.id} data-testid={`zone-${zone.id}`}>
              <span>{zone.name}</span>
              <span className={zone.owner === 0 ? 'held' : 'lost'}>
                {zone.contested
                  ? 'contested'
                  : zone.owner === 0
                    ? 'held'
                    : zone.contender === 0
                      ? `${Math.round((zone.progress / zone.captureSeconds) * 100)}%`
                      : zone.owner === null
                        ? 'neutral'
                        : 'enemy'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ObjectiveList({ objectives, zones }: ObjectiveListProps) {
  const compact = useCompactLayout();
  const [open, setOpen] = useState(false);
  if (objectives.length === 0) return null;

  if (!compact) {
    return (
      <div className="objectives" data-testid="objective-list">
        <ObjectiveBody objectives={objectives} zones={zones} />
      </div>
    );
  }

  const complete = objectives.filter((objective) => objective.status === 'complete').length;
  return (
    <details
      className="objectives mobile-objectives"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid="objective-list"
    >
      <summary>
        Mission <span>{complete}/{objectives.length}</span>
      </summary>
      <ObjectiveBody objectives={objectives} zones={zones} />
    </details>
  );
}
