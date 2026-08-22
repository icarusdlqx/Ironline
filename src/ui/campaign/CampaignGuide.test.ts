import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignGuide } from './CampaignGuide';

describe('campaign first-drop guide', () => {
  it('offers a way back to the full company interface', () => {
    const html = renderToStaticMarkup(
      createElement(CampaignGuide, { stage: 'choose', onDismiss: () => undefined }),
    );
    expect(html).toContain('Choose the job');
    expect(html).toContain('campaign-guide-dismiss');
    expect(html).toContain('Show full company');
  });

  it('leaves no guide behind once the corridor is complete', () => {
    expect(renderToStaticMarkup(
      createElement(CampaignGuide, { stage: 'done', onDismiss: () => undefined }),
    )).toBe('');
  });
});
