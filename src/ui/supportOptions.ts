import type { SupportRules } from '../schema/rules';
import type { SupportCallId } from '../sim/support';

export interface SupportOption {
  id: SupportCallId;
  label: string;
  cost: number;
  effect: string;
  placement: string;
}

const STANDARD_CALLS: readonly SupportCallId[] = [
  'sensor_probe',
  'air_strike',
  'repair_truck',
];

// A mission-authored reserve is the exception. It displaces the probe so the
// immediate damage and recovery choices remain without growing a fourth button.
const RESERVE_CALLS: readonly SupportCallId[] = [
  'air_strike',
  'repair_truck',
  'reinforcement',
];

export function supportCallIds(reserves: number): readonly SupportCallId[] {
  return reserves > 0 ? RESERVE_CALLS : STANDARD_CALLS;
}

function timing(delaySeconds: number): string {
  return delaySeconds === 0 ? 'with no delay' : `after ${delaySeconds}s`;
}

function describe(call: SupportCallId, rules: SupportRules): Omit<SupportOption, 'id' | 'cost'> {
  switch (call) {
    case 'sensor_probe': {
      const entry = rules.sensor_probe;
      return {
        label: 'Sensor Probe',
        effect: `Reveal contacts within ${entry.radius}m for ${entry.durationSeconds}s ${timing(entry.delaySeconds)}.`,
        placement: 'Click or tap the centre of the sweep.',
      };
    }
    case 'air_strike': {
      const entry = rules.air_strike;
      return {
        label: 'Air Strike',
        effect: `${entry.shots} × ${entry.damage} damage across a ${entry.length} × ${entry.width}m lane ${timing(entry.delaySeconds)}.`,
        placement: 'Drag the lane on desktop, or tap for the default approach.',
      };
    }
    case 'repair_truck': {
      const entry = rules.repair_truck;
      return {
        label: 'Repair Truck',
        effect: `Restore ${entry.armourPerSecond} armour/s to each friendly within ${entry.radius}m for ${entry.durationSeconds}s ${timing(entry.delaySeconds)}.`,
        placement: 'Click or tap where damaged mechs can gather.',
      };
    }
    case 'reinforcement':
      return {
        label: 'Reinforcement',
        effect: `Drop one mission reserve ${timing(rules.reinforcement.delaySeconds)}.`,
        placement: 'Click or tap a clear drop point.',
      };
    case 'artillery_strike': {
      const entry = rules.artillery_strike;
      return {
        label: 'Artillery Strike',
        effect: `${entry.shots} × ${entry.damage} damage within ${entry.radius}m ${timing(entry.delaySeconds)}; ${entry.scatter}m scatter.`,
        placement: 'Click or tap the centre of the barrage.',
      };
    }
    case 'minelayer': {
      const entry = rules.minelayer;
      return {
        label: 'Minelayer',
        effect: `${entry.mines} mines deal ${entry.damage} damage within ${entry.radius}m for ${entry.durationSeconds}s ${timing(entry.delaySeconds)}.`,
        placement: 'Click or tap the centre of the field.',
      };
    }
  }
}

export function buildSupportOptions(rules: SupportRules, reserves: number): SupportOption[] {
  return supportCallIds(reserves).map((id) => ({
    id,
    cost: rules[id].cost,
    ...describe(id, rules),
  }));
}

export function supportRadius(rules: SupportRules, call: SupportCallId | null): number | null {
  if (call === 'sensor_probe') return rules.sensor_probe.radius;
  if (call === 'repair_truck') return rules.repair_truck.radius;
  return null;
}
