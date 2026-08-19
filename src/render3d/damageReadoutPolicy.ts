import type { MechLocation } from '../schema/common';

export interface ReadoutCueFacts {
  location: MechLocation | null;
  armour?: number;
  structure?: number;
  misses?: number;
  critical?: string | null;
  locationLost?: boolean;
  ammo?: number;
  destroyed?: boolean;
}

export interface ReadoutFacts {
  armour: number;
  structure: number;
  misses: number;
  criticalCount: number;
  criticals: ReadonlySet<string>;
  lostLocations: ReadonlySet<MechLocation>;
  ammo: number;
  priority: number;
}

export const READOUT_PRIORITY = {
  miss: 0,
  armour: 1,
  structure: 2,
  critical: 3,
  major: 4,
  terminal: 5,
} as const;

export const READOUT_BURST_TICKS = 6;
export const READOUT_COMPACT_WIDTH = 700;
export const READOUT_COMPACT_HEIGHT = 500;
export const READOUT_COMPACT_LANDSCAPE_WIDTH = 940;
export const DEFAULT_READOUT_CAPACITY = 8;
export const MAX_READOUT_CAPACITY = 16;

const LIFE_SECONDS = [0.48, 0.72, 0.95, 1.08, 1.2, 1.35] as const;

function amount(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function locationName(location: MechLocation): string {
  return location.replace(/_/g, ' ').toUpperCase();
}

export function readoutPriority(cue: ReadoutCueFacts): number {
  if (cue.destroyed === true) return READOUT_PRIORITY.terminal;
  if ((cue.ammo ?? 0) > 0 || cue.locationLost === true) return READOUT_PRIORITY.major;
  if (cue.critical !== undefined) return READOUT_PRIORITY.critical;
  if ((cue.structure ?? 0) > 0) return READOUT_PRIORITY.structure;
  if ((cue.armour ?? 0) > 0) return READOUT_PRIORITY.armour;
  return READOUT_PRIORITY.miss;
}

export function compactReadouts(width: number, height = Number.POSITIVE_INFINITY): boolean {
  return (
    width <= READOUT_COMPACT_WIDTH ||
    (height <= READOUT_COMPACT_HEIGHT && width <= READOUT_COMPACT_LANDSCAPE_WIDTH)
  );
}

export function readoutBudget(width: number, height = Number.POSITIVE_INFINITY): number {
  return compactReadouts(width, height) ? 4 : 8;
}

export function readoutLife(priority: number): number {
  return LIFE_SECONDS[priority] ?? LIFE_SECONDS[READOUT_PRIORITY.terminal];
}

/** A battlefield consequence replaces the weaker projectile facts beneath it. */
export function readoutLabel(facts: ReadoutFacts, compact: boolean): string {
  if (facts.priority === READOUT_PRIORITY.terminal) {
    return 'DESTROYED';
  }
  if (facts.priority === READOUT_PRIORITY.major) {
    const locations = [...facts.lostLocations].map(locationName).join(' / ');
    if (facts.ammo > 0 && locations !== '') return `AMMO DETONATION · ${locations} LOST`;
    if (facts.ammo > 0) return 'AMMO DETONATION';
    return locations === '' ? 'LOCATION LOST' : `${locations} LOST`;
  }
  if (facts.criticalCount > 0) {
    const count = facts.criticalCount === 1 ? '' : ` x${String(facts.criticalCount)}`;
    const components = [...facts.criticals].map((name) => name.toUpperCase()).join(' / ');
    const critical = `CRITICAL${count}${components === '' ? '' : `: ${components}`}`;
    return facts.structure > 0
      ? `-${amount(facts.structure)} STRUCTURE · ${critical}`
      : critical;
  }
  if (facts.structure > 0) return `-${amount(facts.structure)} STRUCTURE`;
  if (facts.armour > 0) {
    if (compact && facts.armour < 4) return '';
    return `-${amount(facts.armour)} ARMOUR`;
  }
  if (facts.misses > 0) return facts.misses === 1 ? 'MISS' : `MISS x${String(facts.misses)}`;
  return '';
}

export function readoutTone(priority: number): string {
  if (priority === READOUT_PRIORITY.terminal) return 'terminal';
  if (priority === READOUT_PRIORITY.major) return 'danger';
  if (priority === READOUT_PRIORITY.critical) return 'critical';
  if (priority === READOUT_PRIORITY.structure) return 'structure';
  if (priority === READOUT_PRIORITY.armour) return 'armour';
  return 'miss';
}
