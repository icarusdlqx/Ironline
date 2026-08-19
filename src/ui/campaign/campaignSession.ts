import { startFreshCampaign } from '../../campaign/freshness';
import {
  campaignPersistenceStatus,
  loadCampaign,
  saveCampaign,
  type CampaignPersistenceResult,
  type CampaignPersistenceState,
} from '../../campaign/save';
import type { CampaignState } from '../../campaign/types';
import type { Catalog } from '../../schema/load';

export type CampaignChange = (draft: CampaignState) => string | null | void;

export function openCampaignSession(
  catalog: Catalog,
  campaignId: string,
  onEmpty: () => void,
): { state: CampaignState; persistence: CampaignPersistenceState } {
  const saved = loadCampaign(catalog);
  if (saved.state !== null) return { state: saved.state, persistence: saved.persistence };
  onEmpty();
  const state = startFreshCampaign(catalog, campaignId);
  return { state, persistence: campaignPersistenceStatus() };
}

/** Recovery keeps the company usable without surrendering the damaged save. */
export function commitCampaignChange(
  state: CampaignState,
  change: CampaignChange,
): {
  state: CampaignState;
  message: string | null | void;
  persistence: CampaignPersistenceResult;
} {
  const draft = JSON.parse(JSON.stringify(state)) as CampaignState;
  const message = change(draft);
  const persistence = saveCampaign(draft);
  return { state: draft, message, persistence };
}
