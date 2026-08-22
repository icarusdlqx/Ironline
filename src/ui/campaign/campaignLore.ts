import type { LoreEntry } from '../../schema/lore';

/** Campaign discoveries stay off the board until the company has seen them. */
export function visibleCampaignLore(
  entries: readonly LoreEntry[],
  completedNodes: readonly string[],
): LoreEntry[] {
  const completed = new Set(completedNodes);
  return entries.filter(
    (entry) => entry.unlockNodeId === undefined || completed.has(entry.unlockNodeId),
  );
}
