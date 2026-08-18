import { describe, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/support';
import { sideContracts } from './sidework';
import { createCampaignSeed, startFreshCampaign } from './freshness';

describe('campaign run codes', () => {
  it('turns injected entropy into a readable, repeatable code', () => {
    const words = [2, 3, 0x89abcdef];
    const nextWord = (): number => words.shift() ?? 0;

    expect(createCampaignSeed(nextWord)).toBe('brass-forge-89abcdef');
  });

  it('persists a new run under the generated code before returning it', () => {
    const persist = vi.fn();
    const state = startFreshCampaign(
      catalog,
      'border_dispute',
      () => 'copper-relay-0000002a',
      persist,
    );

    expect(state.seed).toBe('copper-relay-0000002a');
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(state);
  });

  it('gives two injected run codes two stable hiring halls', () => {
    const first = startFreshCampaign(catalog, 'border_dispute', () => 'first-run', vi.fn());
    const second = startFreshCampaign(catalog, 'border_dispute', () => 'second-run', vi.fn());

    const firstBoard = sideContracts(catalog, first);
    expect(sideContracts(catalog, first)).toEqual(firstBoard);
    expect(sideContracts(catalog, second)).not.toEqual(firstBoard);
  });
});
