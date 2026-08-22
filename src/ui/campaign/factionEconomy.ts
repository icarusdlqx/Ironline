import type { Faction } from '../../schema/faction';
import { FactionSchema } from '../../schema/faction';
import type { Catalog } from '../../schema/load';

const FACTION_LABELS: Record<Faction, string> = {
  linewrought: 'Linewrought',
  aurelian: 'Aurelian Stock (Sealed)',
};

function listLabels(factions: readonly Faction[]): string {
  return factions.map((faction) => FACTION_LABELS[faction]).join(' and ');
}

function factor(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

export function factionLabel(faction: Faction): string {
  return FACTION_LABELS[faction];
}

export function workshopFactionLine(catalog: Catalog, faction: Faction): string {
  const factors = catalog.rules.economy.repair.factionFactors[faction];
  const marketSupported = catalog.rules.economy.market.availableFactions.includes(faction);
  return `${factionLabel(faction)} · ${factor(factors.cost)}× workshop cost · ${factor(factors.days)}× workshop time · ${marketSupported ? 'local repair supply' : 'replacement parts salvage-only'}`;
}

export function yardStockLine(catalog: Catalog): string {
  const available = FactionSchema.options.filter((faction) =>
    catalog.rules.economy.market.availableFactions.includes(faction),
  );
  const salvageOnly = FactionSchema.options.filter((faction) => !available.includes(faction));
  const stock = `Yard stock: ${listLabels(available)} machines only.`;
  if (salvageOnly.length === 0) return stock;
  return `${stock} ${listLabels(salvageOnly)} machines and replacement parts are salvage-only.`;
}
