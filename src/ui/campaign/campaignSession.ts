import { saveCampaign } from '../../campaign/save';
import type { CampaignState } from '../../campaign/types';

export type CampaignChange = (draft: CampaignState) => string | null | void;

/** A base transaction is durable before the screen announces it. */
export function commitCampaignChange(
  state: CampaignState,
  change: CampaignChange,
): { state: CampaignState; message: string | null | void } {
  const draft = JSON.parse(JSON.stringify(state)) as CampaignState;
  const message = change(draft);
  saveCampaign(draft);
  return { state: draft, message };
}
