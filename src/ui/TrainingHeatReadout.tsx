import type { UnitSnapshot } from './store';

interface TrainingHeatReadoutProps {
  unit: Pick<UnitSnapshot, 'heat' | 'heatCapacity' | 'name'> | null;
}

export function TrainingHeatReadout({ unit }: TrainingHeatReadoutProps) {
  const capacity = Math.max(1, unit?.heatCapacity ?? 1);
  const heat = Math.max(0, unit?.heat ?? 0);
  const percent = Math.min(100, Math.round((heat / capacity) * 100));

  return (
    <section className="training-heat" data-testid="training-heat-readout">
      <span>Reactor heat</span>
      <strong>{unit?.name ?? 'Select a mech'}</strong>
      <div
        className="training-heat-track"
        role="progressbar"
        aria-label="Current reactor heat"
        aria-valuemin={0}
        aria-valuemax={Math.round(capacity)}
        aria-valuenow={Math.round(heat)}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <small>
        {unit === null
          ? 'Select a machine to read its heat.'
          : `${Math.round(heat)} / ${Math.round(capacity)} · pause or hold fire before shutdown`}
      </small>
    </section>
  );
}
