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

/**
 * Turns a display name into a legal id. Ids are lower_snake_case and have to
 * start with a letter, so a name of digits or punctuation alone falls back to
 * a fixed stem rather than producing something the schema will not load.
 */
export function idFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '');
  return slug === '' ? 'custom_design' : slug;
}

/**
 * Renaming renames the design. Storage is keyed on the id, so leaving it pinned
 * to whatever stock design the player started from meant the second variant
 * they built silently replaced the first.
 */
export function setName(design: Design, name: string): Design {
  const next = copy(design);
  next.name = name;
  next.id = idFromName(name);
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

/**
 * Everything that leaves the bay has to satisfy the loadout rules AND the
 * schema. The loadout rules alone let a build with a blank name through, and
 * the blank name only surfaces on the way back in, as a file that will not load.
 */
export function designIssues(catalog: Catalog, design: Design): string[] {
  const loadout = computeLoadout(catalog, design);
  const issues = loadout.valid ? [] : loadout.issues.map((issue) => issue.message);

  const parsed = DesignSchema.safeParse(design);
  if (parsed.success) return issues;

  return [
    ...issues,
    ...parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    ),
  ];
}

function checkOrThrow(catalog: Catalog, design: Design): void {
  const issues = designIssues(catalog, design);
  if (issues.length > 0) throw new InvalidBuildError(issues);
}

/**
 * Refuses to persist anything the rules reject. Reports whether it replaced an
 * existing entry, so a save that lands on a name already in use can say so
 * instead of quietly discarding the earlier build.
 */
export function saveToStorage(catalog: Catalog, design: Design): { replaced: boolean } {
  checkOrThrow(catalog, design);

  const key = `${STORAGE_PREFIX}${design.id}`;
  const replaced = globalThis.localStorage?.getItem(key) != null;
  globalThis.localStorage?.setItem(key, serialiseDesign(design));
  return { replaced };
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
  checkOrThrow(catalog, design);
  return new Blob([serialiseDesign(design)], { type: 'application/json' });
}
