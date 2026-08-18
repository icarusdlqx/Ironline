import type { Catalog } from '../schema/load';
import { startCampaign } from './campaign';
import { saveCampaign } from './save';
import type { CampaignState } from './types';

const LEADS = [
  'ashen',
  'black',
  'brass',
  'cinder',
  'cold',
  'copper',
  'dry',
  'fallow',
  'grey',
  'iron',
  'red',
  'salt',
  'shale',
  'slag',
  'smoke',
  'winter',
] as const;

const MARKS = [
  'anvil',
  'bastion',
  'causeway',
  'forge',
  'garrison',
  'hammer',
  'harrow',
  'kiln',
  'march',
  'picket',
  'quarry',
  'relay',
  'ridge',
  'spindle',
  'switchback',
  'yard',
] as const;

export type CampaignSeedFactory = () => string;
export type EntropyWord = () => number;

function secureWord(): number {
  const word = new Uint32Array(1);
  globalThis.crypto.getRandomValues(word);
  return word[0] ?? 0;
}

/** A run code is short enough to copy from a screenshot and large enough not to collide by habit. */
export function createCampaignSeed(nextWord: EntropyWord = secureWord): string {
  const lead = LEADS[(nextWord() >>> 0) % LEADS.length];
  const mark = MARKS[(nextWord() >>> 0) % MARKS.length];
  const serial = (nextWord() >>> 0).toString(16).padStart(8, '0');
  return `${lead}-${mark}-${serial}`;
}

/** New runs are written at once so reload cannot silently replace their board. */
export function startFreshCampaign(
  catalog: Catalog,
  campaignId: string,
  makeSeed: CampaignSeedFactory = createCampaignSeed,
  persist: (state: CampaignState) => void = saveCampaign,
): CampaignState {
  const state = startCampaign(catalog, campaignId, makeSeed());
  persist(state);
  return state;
}
