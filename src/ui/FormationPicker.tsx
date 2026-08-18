import {
  FORMATION_PRESETS,
  isFormationPreset,
  type FormationPreset,
} from './formationPreset';

interface FormationPickerProps {
  value: FormationPreset;
  compact?: boolean;
  onChange: (preset: FormationPreset) => void;
}

const EXPLANATION =
  'Sets where a selected group finishes. The machines choose their own routes and do not hold this shape while moving.';

export function FormationPicker({ value, compact = false, onChange }: FormationPickerProps) {
  return (
    <label
      className={`formation-picker${compact ? ' compact' : ''}`}
      data-active={value}
      data-testid="formation-picker"
      title={EXPLANATION}
    >
      <span className="formation-picker-label">End shape</span>
      <select
        aria-label="Formation at destination"
        value={value}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        onChange={(event) => {
          if (isFormationPreset(event.currentTarget.value)) onChange(event.currentTarget.value);
        }}
        data-testid="formation-preset"
      >
        {FORMATION_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      <span className="formation-picker-note">destination only</span>
    </label>
  );
}
