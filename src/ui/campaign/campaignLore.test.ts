import { describe, expect, it } from 'vitest';
import type { LoreEntry } from '../../schema/lore';
import { visibleCampaignLore } from './campaignLore';

const publicPage: LoreEntry = {
  id: 'public',
  title: 'Public',
  order: 0,
  summary: 'Known before the first contract.',
  body: ['Known.'],
};

const discovery: LoreEntry = {
  id: 'discovery',
  title: 'Discovery',
  order: 1,
  unlockNodeId: 'sealed_contact',
  summary: 'Learned in the field.',
  body: ['Recovered.'],
};

describe('campaign lore', () => {
  it('keeps discoveries out of the manual until their contract is complete', () => {
    expect(visibleCampaignLore([publicPage, discovery], [])).toEqual([publicPage]);
    expect(visibleCampaignLore([publicPage, discovery], ['sealed_contact'])).toEqual([
      publicPage,
      discovery,
    ]);
  });
});
