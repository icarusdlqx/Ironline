import type { Design } from '../schema/design';
import { DesignSchema } from '../schema/design';
import type { Catalog } from '../schema/load';
import type { LanceEntry } from '../sim/world';

/**
 * The player's skirmish lance: what drops into a mission when no campaign is
 * running. Campaign drops are decided by the dropship manifest; a skirmish
 * needed the same decision and never offered it — the mission file's authored
 * lance deployed, and the bay was a sandbox whose builds went nowhere.
 *
 * A berth holds either a reference to a catalogue design (`designId`) or a
 * whole customised design carried inline (`design`). Stock picks stay
 * references so they keep up with balance patches; a build edited in the bay
 * is frozen inline, because it belongs to the player rather than the game.
 */
export interface SkirmishBerth {
  designId: string | null;
  design?: Design;
  pilotId: string;
  /** Deliberately left empty: the drop is sized by tonnage, not berth count. */
  empty?: boolean;
}

const STORAGE_PREFIX = 'ironline.lance.';

/** The lance the mission itself fields, as the starting point. */
export function defaultLance(catalog: Catalog, missionId: string): SkirmishBerth[] {
  const mission = catalog.missions.get(missionId);
  const lance = mission?.lances.find((entry) => entry.team === 0);
  return (lance?.units ?? []).map((unit) => ({
    designId: unit.designId,
    pilotId: unit.pilotId,
  }));
}

/** The stored lance for a mission, falling back to the authored one. */
export function loadLance(catalog: Catalog, missionId: string): SkirmishBerth[] {
  const fallback = defaultLance(catalog, missionId);
  const raw = globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${missionId}`);
  if (raw === null || raw === undefined) return fallback;

  try {
    const parsed = JSON.parse(raw) as SkirmishBerth[];
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) return fallback;

    const berths: SkirmishBerth[] = [];
    for (const entry of parsed) {
      if (typeof entry.pilotId !== 'string' || !catalog.pilots.has(entry.pilotId)) return fallback;
      if (entry.empty === true) {
        berths.push({ designId: null, pilotId: entry.pilotId, empty: true });
        continue;
      }
      if (entry.designId !== null) {
        if (!catalog.designs.has(entry.designId)) return fallback;
        berths.push({ designId: entry.designId, pilotId: entry.pilotId });
        continue;
      }
      // An inline design is player data from an older session: validate it the
      // way a save file is validated, and fall back rather than crash the boot.
      const design = DesignSchema.safeParse(entry.design);
      if (!design.success) return fallback;
      berths.push({ designId: null, design: design.data, pilotId: entry.pilotId });
    }
    return berths;
  } catch {
    return fallback;
  }
}

export function storeLance(missionId: string, lance: SkirmishBerth[]): void {
  try {
    globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${missionId}`, JSON.stringify(lance));
  } catch {
    // Private browsing: the loadout lasts for the session only.
  }
}

export function berthDesign(catalog: Catalog, berth: SkirmishBerth): Design | null {
  if (berth.empty === true) return null;
  if (berth.designId !== null) return catalog.designs.get(berth.designId) ?? null;
  return berth.design ?? null;
}

export function berthTonnage(catalog: Catalog, berth: SkirmishBerth): number {
  const design = berthDesign(catalog, berth);
  if (design === null) return 0;
  return catalog.chassis.get(design.chassisId)?.tonnage ?? 0;
}

export function lanceTonnage(catalog: Catalog, lance: readonly SkirmishBerth[]): number {
  return lance.reduce((total, berth) => total + berthTonnage(catalog, berth), 0);
}

/** The lance as the simulation wants it, or null if a berth cannot resolve. */
export function lanceEntries(
  catalog: Catalog,
  lance: readonly SkirmishBerth[],
): LanceEntry[] | null {
  const entries: LanceEntry[] = [];
  for (const berth of lance) {
    // An empty berth is a choice, not a failure: three heavies instead of
    // four mediums is a legitimate answer to a tonnage allowance.
    if (berth.empty === true) continue;
    const design = berthDesign(catalog, berth);
    const pilot = catalog.pilots.get(berth.pilotId);
    if (design === null || pilot === undefined) return null;
    entries.push({ design, pilot });
  }
  return entries.length === 0 ? null : entries;
}
