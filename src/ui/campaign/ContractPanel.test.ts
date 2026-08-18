import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { negotiationOptions } from '../../campaign/contractTerms';
import { employerById, employerHistories } from '../../campaign/employers';
import { ContractPanel } from './ContractPanel';

describe('contract panel', () => {
  const node = catalog.campaigns.get('border_dispute')?.nodes[0];

  it('shows three complete offers before the player signs', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const campaign = catalog.campaigns.get('border_dispute');
    if (campaign === undefined) throw new Error('missing campaign');
    const options = negotiationOptions(catalog, node);
    const employers = employerHistories(campaign, []);

    const html = renderToStaticMarkup(
      createElement(ContractPanel, {
        contract: null,
        node,
        options,
        selectedTerms: 'standard',
        salvageRules: catalog.rules.salvage,
        readyMechs: 4,
        finished: false,
        won: false,
        employer: employers.find((record) => record.id === node.employerId) ?? null,
        employers,
        onSelectTerms: () => undefined,
        onAccept: () => undefined,
        onDeploy: () => undefined,
        onAbandon: () => undefined,
      }),
    );

    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('Fee first');
    expect(html).toContain('Standard split');
    expect(html).toContain('Salvage first');
    expect(html).toContain('on success');
    expect(html).toContain('Repair cover: none');
    expect(html).toContain(`${Math.round((options[1]?.salvageShare ?? 0) * 100)}% salvage`);
    expect(html).toContain('Enemy walking-hull recovery');
    expect(html).toContain('Both legs destroyed; side defeated');
    expect(html).toContain('Kestrel Combine');
    expect(html).toContain('0 completed · 0 failed · 0 C paid');
    expect(html).toContain('<summary>Employers</summary>');
  });

  it('shows the stored package after signing', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const campaign = catalog.campaigns.get('border_dispute');
    if (campaign === undefined) throw new Error('missing campaign');
    const terms = negotiationOptions(catalog, node)[2];
    if (terms === undefined) throw new Error('missing salvage package');
    const identity = employerById(campaign, node.employerId);
    const employers = employerHistories(campaign, []);

    const html = renderToStaticMarkup(
      createElement(ContractPanel, {
        contract: {
          nodeId: node.id,
          missionId: node.missionId,
          employerId: identity.id,
          employerName: identity.name,
          termsId: terms.id,
          payout: terms.payout,
          salvageShare: terms.salvageShare,
          acceptedOnDay: 0,
          deadlineDay: node.deadlineDays,
        },
        node: null,
        options: [],
        selectedTerms: 'standard',
        salvageRules: catalog.rules.salvage,
        readyMechs: 4,
        finished: false,
        won: false,
        employer: employers.find((record) => record.id === node.employerId) ?? null,
        employers,
        onSelectTerms: () => undefined,
        onAccept: () => undefined,
        onDeploy: () => undefined,
        onAbandon: () => undefined,
      }),
    );

    expect(html).toContain('Salvage first');
    expect(html).toContain('on success');
    expect(html).toContain(`${Math.round(terms.salvageShare * 100)}% salvage`);
    expect(html).toContain('Kestrel Combine');
  });
});
