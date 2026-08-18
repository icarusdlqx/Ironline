import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { employerHistories } from '../../campaign/employers';
import { startCampaign } from '../../campaign/campaign';
import { sideContracts } from '../../campaign/sidework';
import { EmployerLedger } from './EmployerLedger';
import { HiringHall } from './HiringHall';

describe('employer campaign UI', () => {
  const campaign = catalog.campaigns.get('border_dispute');
  if (campaign === undefined) throw new Error('missing campaign');

  it('renders the factual ledger as a compact disclosure', () => {
    const employers = employerHistories(campaign, []);
    const html = renderToStaticMarkup(createElement(EmployerLedger, { employers }));

    expect(html).toContain('<details');
    expect(html).toContain('<summary>Employers</summary>');
    expect(html).toContain('Kestrel Combine');
    expect(html).toContain('0 completed · 0 failed · 0 C paid');
    expect(html.match(/data-testid="employer-ledger-/g)).toHaveLength(campaign.employers.length);
  });

  it('shows each side-work client and its recorded history beside the offer', () => {
    const state = startCampaign(catalog, campaign.id, 'employer-offers');
    const offers = sideContracts(catalog, state);
    const employers = employerHistories(campaign, state.history);
    const html = renderToStaticMarkup(
      createElement(HiringHall, {
        catalog,
        campaign,
        day: state.day,
        offers,
        employers,
        selectedId: offers[0]?.id ?? null,
        onSelect: () => undefined,
      }),
    );

    for (const offer of offers) {
      const employer = campaign.employers.find((entry) => entry.id === offer.employerId);
      expect(html).toContain(employer?.name ?? 'Independent employer');
    }
    expect(html).toContain('0 completed · 0 failed · 0 C paid');
  });

  it('keeps the ledger disclosure reachable on a narrow touch screen', () => {
    const css = readFileSync(new URL('./employers.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media[^{]+max-width:\s*640px/);
    expect(css).toMatch(/pointer:\s*coarse/);
    expect(css).toMatch(/\.employer-ledger summary\s*\{[^}]*min-height:\s*44px/s);
  });
});
