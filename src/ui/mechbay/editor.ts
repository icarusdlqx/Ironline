import type { MechLocation } from '../../schema/common';
import { LOCATIONS } from '../../schema/common';
import { DesignSchema, type Design } from '../../schema/design';
import type { Catalog } from '../../schema/load';
import { computeLoadout, maximiseArmour as fitArmour } from '../../sim/loadout';

const STORAGE_PREFIX = 'ironline.design.';

function copy(design: Design): Design {
  return JSON.parse(JSON.stringify(design)) as Design;
}

export function blankDesign(catalog: Catalog, chassisId: string): Design {
  const chassis = catalog.chassis.get(chassisId);
  if (chassis === undefined) throw new Error(`unknown chassis "${chassisId}"`);

  return {
    id: `${chassisId}_custom`,
    name: `${chassis.name} 'Custom'`,
    chassisId,
    armour: Object.fromEntries(LOCATIONS.map((location) => [location, 0])) as Record<
      MechLocation,
      number
    >,
    heatSinkId: 'heat_sink',
    heatSinks: chassis.internalHeatSinks,
    mounts: [],
    ammo: [],
    equipment: [],
  };
}

export function addMount(design: Design, weaponId: string, location: MechLocation): Design {
  const next = copy(design);
  next.mounts.push({ weaponId, location });
  return next;
}

export function removeMount(design: Design, index: number): Design {
  const next = copy(design);
  next.mounts.splice(index, 1);
  return next;
}

export function addEquipment(design: Design, equipmentId: string, location: MechLocation): Design {
  const next = copy(design);
  next.equipment.push({ equipmentId, location });
  return next;
}

export function removeEquipment(design: Design, index: number): Design {
  const next = copy(design);
  next.equipment.splice(index, 1);
  return next;
}

export function addAmmo(design: Design, weaponId: string, location: MechLocation): Design {
  const next = copy(design);
  const existing = next.ammo.find(
    (entry) => entry.weaponId === weaponId && entry.location === location,
  );
  if (existing === undefined) next.ammo.push({ weaponId, location, tons: 1 });
  else existing.tons += 1;
  return next;
}

export function removeAmmo(design: Design, index: number): Design {
  const next = copy(design);
  const entry = next.ammo[index];
  if (entry === undefined) return next;
  if (entry.tons > 1) entry.tons -= 1;
  else next.ammo.splice(index, 1);
  return next;
}

export function setArmour(design: Design, location: MechLocation, value: number): Design {
  const next = copy(design);
  next.armour[location] = Math.max(0, Math.round(value));
  return next;
}

export function setHeatSinks(design: Design, count: number): Design {
  const next = copy(design);
  next.heatSinks = Math.max(0, Math.round(count));
  return next;
}

export function setHeatSinkId(design: Design, heatSinkId: string): Design {
  const next = copy(design);
  next.heatSinkId = heatSinkId;
  return next;
}

export function setName(design: Design, name: string): Design {
  const next = copy(design);
  next.name = name;
  return next;
}

export function maximiseArmour(catalog: Catalog, design: Design): Design {
  return fitArmour(catalog, design);
}

export function serialiseDesign(design: Design): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}

export interface ParseResult {
  design: Design | null;
  error: string | null;
}

export function parseDesign(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { design: null, error: `not valid JSON: ${(error as Error).message}` };
  }

  const parsed = DesignSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      design: null,
      error: `${first?.path.map(String).join('.') || '(root)'}: ${first?.message ?? 'invalid design'}`,
    };
  }

  return { design: parsed.data, error: null };
}

export class InvalidBuildError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`build is not legal:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidBuildError';
  }
}

/** Refuses to persist anything the loadout rules reject. */
export function saveToStorage(catalog: Catalog, design: Design): void {
  const loadout = computeLoadout(catalog, design);
  if (!loadout.valid) throw new InvalidBuildError(loadout.issues.map((issue) => issue.message));
  globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${design.id}`, serialiseDesign(design));
}

export function listStoredDesigns(): string[] {
  const storage = globalThis.localStorage;
  if (storage === undefined) return [];

  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(STORAGE_PREFIX)) ids.push(key.slice(STORAGE_PREFIX.length));
  }
  return ids.sort();
}

export function loadFromStorage(id: string): ParseResult {
  const text = globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${id}`);
  if (text === null || text === undefined) return { design: null, error: `no saved design "${id}"` };
  return parseDesign(text);
}

export function exportDesign(catalog: Catalog, design: Design): Blob {
  const loadout = computeLoadout(catalog, design);
  if (!loadout.valid) throw new InvalidBuildError(loadout.issues.map((issue) => issue.message));
  return new Blob([serialiseDesign(design)], { type: 'application/json' });
}
