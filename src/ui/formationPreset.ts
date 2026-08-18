export const FORMATION_PRESETS = [
  { id: 'auto', label: 'Auto' },
  { id: 'line', label: 'Line' },
  { id: 'column', label: 'Column' },
  { id: 'wedge', label: 'Wedge' },
  { id: 'box', label: 'Box' },
] as const;

export type FormationPreset = (typeof FORMATION_PRESETS)[number]['id'];

export function isFormationPreset(value: string): value is FormationPreset {
  return FORMATION_PRESETS.some((preset) => preset.id === value);
}
