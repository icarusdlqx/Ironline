import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SolvencyReport } from '../../campaign/solvency';
import { CompanyStatus } from './CompanyStatus';

const terminal: SolvencyReport = {
  state: 'terminal',
  action: 'retire',
  block: 'insufficient_funds',
  recoverOnDay: null,
  plan: {
    pilotName: null,
    pilotCost: 0,
    mechName: 'Cairn',
    mechId: 'mech-1',
    mechCost: 500_000,
    mechSource: 'owned',
    mechNeedsRebuild: true,
    saleBeforePurchase: 0,
    saleAfterPurchase: 0,
    saleProceeds: 0,
    availableCredits: -1,
    requiredCredits: 500_000,
    needsSale: true,
  },
};

describe('company recovery status', () => {
  it('offers retirement as a separate confirmation step', () => {
    const html = renderToStaticMarkup(createElement(CompanyStatus, {
      report: terminal,
      contractActive: false,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));

    expect(html).toContain('Retire this campaign');
    expect(html).not.toContain('Confirm retirement');
  });

  it('requires an active contract to be withdrawn first', () => {
    const html = renderToStaticMarkup(createElement(CompanyStatus, {
      report: terminal,
      contractActive: true,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));

    expect(html).toContain('Withdraw from the active contract');
    expect(html).not.toContain('Retire this campaign');
  });

  it('gives a temporary company its factual return day', () => {
    const report: SolvencyReport = {
      state: 'temporary',
      action: 'wait',
      block: 'none',
      recoverOnDay: 12,
      plan: null,
    };
    const html = renderToStaticMarkup(createElement(CompanyStatus, {
      report,
      contractActive: false,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));

    expect(html).toContain('return the company to the field on day 12');
    expect(html).toContain('Advance to day 12');
  });

  it('distinguishes fresh yard stock from a contract-blocked wait', () => {
    const yard = renderToStaticMarkup(createElement(CompanyStatus, {
      report: {
        state: 'temporary', action: 'wait_yard', block: 'none', recoverOnDay: 14, plan: null,
      },
      contractActive: false,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));
    expect(yard).toContain('New stock arrives on day 14');
    expect(yard).toContain('Advance to day 14');

    const blocked = renderToStaticMarkup(createElement(CompanyStatus, {
      report: {
        state: 'temporary', action: 'withdraw', block: 'none', recoverOnDay: 14, plan: null,
      },
      contractActive: true,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));
    expect(blocked).toContain('falls after the signed deadline');
    expect(blocked).not.toContain('Advance to day 14');
  });

  it('orders a yard purchase before the sale that funds its pilot', () => {
    const report: SolvencyReport = {
      ...terminal,
      state: 'fundable',
      action: 'finance',
      block: 'none',
      plan: {
        ...terminal.plan!,
        pilotName: 'Juno Reyes',
        pilotCost: 480_000,
        mechSource: 'yard',
        mechNeedsRebuild: false,
        saleAfterPurchase: 480_000,
        saleProceeds: 480_000,
        availableCredits: 980_000,
        requiredCredits: 980_000,
      },
    };
    const html = renderToStaticMarkup(createElement(CompanyStatus, {
      report,
      contractActive: false,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));

    expect(html.indexOf('buy Cairn')).toBeLessThan(html.indexOf('sell the retained hull'));
    expect(html.indexOf('sell the retained hull')).toBeLessThan(html.indexOf('sign Juno Reyes'));
  });

  it('describes a sale-funded contract block as recoverable', () => {
    const report: SolvencyReport = {
      ...terminal,
      state: 'temporary',
      action: 'withdraw',
      block: 'none',
    };
    const html = renderToStaticMarkup(createElement(CompanyStatus, {
      report,
      contractActive: true,
      onAdvance: () => undefined,
      onRetire: () => undefined,
    }));
    expect(html).toContain('active contract blocks the hull sales');
    expect(html).toContain('reassess the books');
    expect(html).not.toContain('closing the company');
  });
});
