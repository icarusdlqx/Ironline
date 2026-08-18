import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { negotiationOptions } from '../../campaign/contractTerms';
import { ContractPanel } from './ContractPanel';

describe('contract panel', () => {
  const node = catalog.campaigns.get('border_dispute')?.nodes[0];

  it('shows three complete offers before the player signs', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const options = negotiationOptions(catalog, node);

    const html = renderToStaticMarkup(
      createElement(ContractPanel, {
        contract: null,
        node,
        options,
        selectedTerms: 'standard',
        readyMechs: 4,
        finished: false,
        won: false,
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
  });

  it('shows the stored package after signing', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const terms = negotiationOptions(catalog, node)[2];
    if (terms === undefined) throw new Error('missing salvage package');

    const html = renderToStaticMarkup(
      createElement(ContractPanel, {
        contract: {
          nodeId: node.id,
          missionId: node.missionId,
          employer: node.employer,
          termsId: terms.id,
          payout: terms.payout,
          salvageShare: terms.salvageShare,
          acceptedOnDay: 0,
          deadlineDay: node.deadlineDays,
        },
        node: null,
        options: [],
        selectedTerms: 'standard',
        readyMechs: 4,
        finished: false,
        won: false,
        onSelectTerms: () => undefined,
        onAccept: () => undefined,
        onDeploy: () => undefined,
        onAbandon: () => undefined,
      }),
    );

    expect(html).toContain('Salvage first');
    expect(html).toContain('on success');
    expect(html).toContain(`${Math.round(terms.salvageShare * 100)}% salvage`);
  });
});
