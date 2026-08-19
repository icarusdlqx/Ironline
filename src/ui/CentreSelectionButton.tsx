import type { Engine } from './engine';
import { centreOnSelection } from './cameraNavigation';

export function CentreSelectionButton({
  engine,
  className,
}: {
  engine: Engine | null;
  className: string;
}) {
  const disabled = engine === null || engine.selectedEntities().length === 0;
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => centreOnSelection(engine)}
      aria-label="Centre camera on selection"
      title="Centre camera on selection"
      data-testid="centre-selection"
    >
      Centre
    </button>
  );
}
