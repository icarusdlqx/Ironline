import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalog } from '../../../tests/support';
import { startCampaign } from '../../campaign/campaign';
import { formatMissionClock } from '../../campaign/contractBriefing';
import { negotiationOptions } from '../../campaign/contractTerms';
import { employerById, employerHistories } from '../../campaign/employers';
import { dailyPayroll, payrollThrough } from '../../campaign/ledger';
import { sideContractProfile } from '../../campaign/sidework';
import { ContractBriefing } from './ContractBriefing';
import { ContractPanel } from './ContractPanel';

describe('contract panel', () => {
  const node = catalog.campaigns.get('border_dispute')?.nodes[0];

  it('shows three complete offers before the player signs', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const campaign = catalog.campaigns.get('border_dispute');
    if (campaign === undefined) throw new Error('missing campaign');
    const options = negotiationOptions(catalog, node);
    const employers = employerHistories(campaign, []);
    const state = startCampaign(catalog, campaign.id, 'contract-facts');
    const profile = sideContractProfile(catalog, node.missionId);
    if (profile === null) throw new Error('missing mission profile');
    const deadlineDay = state.day + node.deadlineDays;

    const html = renderToStaticMarkup(
      createElement(ContractPanel, {
        catalog,
        state,
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
    expect(html).toContain('on success only');
    expect(html).toContain(`${Math.round((options[1]?.salvageShare ?? 0) * 100)}% salvage`);
    expect(html).toContain(profile.objectives[0] ?? 'missing objective');
    expect(html).toContain(`${formatMissionClock(profile.clockSeconds)} clock`);
    expect(html).toContain(`${profile.dropTonnage}t drop / ${profile.oppositionTonnage}t rated opposition`);
    expect(html).toContain(`day ${state.day} → day ${deadlineDay}`);
    expect(html).toContain(`${dailyPayroll(catalog, state).toLocaleString('en-GB')} C/day now`);
    expect(html).toContain(
      `${payrollThrough(catalog, state, node.deadlineDays).toLocaleString('en-GB')} C maximum`,
    );
    expect(html).toContain('Enemy walking-hull recovery');
    expect(html).toContain('Both legs destroyed; side defeated');
    expect(html).toContain('Kestrel Combine');
    expect(html).toContain('0 completed · 0 failed · 0 C paid');
    expect(html).toContain('<summary>Employers</summary>');
    expect(html).toContain('Recovery odds for standard split terms');
    expect(html).toContain('recovery fee');
    expect(html).toContain('recovery days; route reopens');
    expect(html).toContain('battle damage remains the company workshop bill');
    expect(html).not.toContain('Repair cover');
    expect(html).toContain(node.brief);
  });

  it('shows the stored package after signing', () => {
    if (node === undefined) throw new Error('missing opening contract');
    const campaign = catalog.campaigns.get('border_dispute');
    if (campaign === undefined) throw new Error('missing campaign');
    const terms = negotiationOptions(catalog, node)[2];
    if (terms === undefined) throw new Error('missing salvage package');
    const identity = employerById(campaign, node.employerId);
    const employers = employerHistories(campaign, []);
    const state = startCampaign(catalog, campaign.id, 'signed-contract-facts');

    const html = renderToStaticMarkup(
      createElement(ContractPanel, {
        catalog,
        state,
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
    expect(html).toContain('on success only');
    expect(html).toContain(`${Math.round(terms.salvageShare * 100)}% salvage`);
    expect(html).toContain('Kestrel Combine');
  });

  it('keeps long factual rows wrappable at a 390px phone width', () => {
    const state = startCampaign(catalog, 'border_dispute', 'mobile-contract-facts');
    const mission = catalog.missions.get('relay_chain');
    if (mission === undefined) throw new Error('missing objective-led mission');
    const html = renderToStaticMarkup(
      createElement(ContractBriefing, {
        catalog,
        state,
        missionId: mission.id,
        deadlineDay: state.day + 12,
        nodeId: 'side_0_0',
        terms: { payout: 123_456, salvageShare: 0.625 },
      }),
    );
    const css = readFileSync(new URL('./contractBriefing.css', import.meta.url), 'utf8');

    for (const objective of mission.objectives.filter((entry) => entry.team === 0 && entry.required)) {
      expect(html).toContain(objective.label);
    }
    expect(html).toContain('123,456 C on success only');
    expect(html).toContain('No route-recovery fee');
    expect(css).toMatch(/\.contract-facts dd\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
    expect(css).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.contract-facts > div\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.contract-option\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.camp-hall button\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
  });
});
