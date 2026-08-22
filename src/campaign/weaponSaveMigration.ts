import { canonicalWeaponId, migrateDesignWeaponIds } from '../schema/weaponMigration';
import type { CampaignState, StoreItem } from './types';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function migrateWeaponItem(value: unknown): unknown {
  const item = object(value);
  if (item === null || item.kind !== 'weapon' || typeof item.itemId !== 'string') return value;
  return { ...item, itemId: canonicalWeaponId(item.itemId) };
}

function migrateWeaponItems(value: unknown): unknown {
  return Array.isArray(value) ? value.map(migrateWeaponItem) : value;
}

function migrateProvenance(value: unknown): unknown {
  const item = object(value);
  if (item === null || item.kind !== 'weapon' || typeof item.itemId !== 'string') return value;
  return { ...item, itemId: canonicalWeaponId(item.itemId) };
}

function migrateMech(value: unknown): unknown {
  const mech = object(value);
  if (mech === null) return value;
  return { ...mech, design: migrateDesignWeaponIds(mech.design) };
}

function migrateHistoryRecord(value: unknown): unknown {
  const record = object(value);
  if (record === null) return value;
  return {
    ...record,
    salvagedItems: migrateWeaponItems(record.salvagedItems),
    salvageOffered: migrateWeaponItems(record.salvageOffered),
    salvageProvenance: Array.isArray(record.salvageProvenance)
      ? record.salvageProvenance.map(migrateProvenance)
      : record.salvageProvenance,
  };
}

/** Migrates the raw save before strict parsing, while preserving malformed fields for diagnostics. */
export function migrateWeaponSave(raw: unknown): unknown {
  const save = object(raw);
  const state = object(save?.state);
  if (save === null || state === null) return raw;

  return {
    ...save,
    state: {
      ...state,
      mechs: Array.isArray(state.mechs) ? state.mechs.map(migrateMech) : state.mechs,
      store: migrateWeaponItems(state.store),
      history: Array.isArray(state.history)
        ? state.history.map(migrateHistoryRecord)
        : state.history,
    },
  };
}

function coalesceWeaponItems(items: StoreItem[]): StoreItem[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.kind === 'weapon') totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.count);
  }

  const emitted = new Set<string>();
  return items.flatMap((item) => {
    if (item.kind !== 'weapon') return [item];
    if (emitted.has(item.itemId)) return [];
    emitted.add(item.itemId);
    return [{ ...item, count: totals.get(item.itemId) ?? item.count }];
  });
}

/** Alias collapse can turn two valid crate rows into one inventory key. */
export function coalesceMigratedWeaponItems(state: CampaignState): void {
  state.store = coalesceWeaponItems(state.store);
  for (const outcome of state.history) {
    outcome.salvagedItems = coalesceWeaponItems(outcome.salvagedItems);
    outcome.salvageOffered = coalesceWeaponItems(outcome.salvageOffered);
  }
}
