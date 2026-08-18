export type ClockUrgency = 'steady' | 'minute' | 'final';

export function formatMissionClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function missionClockUrgency(seconds: number): ClockUrgency {
  if (seconds <= 0) return 'steady';
  if (seconds <= 15) return 'final';
  if (seconds <= 60) return 'minute';
  return 'steady';
}

export function crossedMissionClockWarnings(before: number, after: number): string[] {
  const warnings: string[] = [];
  if (before > 60 && after <= 60) warnings.push('Mission clock — one minute remains.');
  if (before > 15 && after <= 15) warnings.push('Mission clock — fifteen seconds remain.');
  return warnings;
}
