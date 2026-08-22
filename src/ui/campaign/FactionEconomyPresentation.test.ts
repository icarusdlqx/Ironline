import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { startCampaign } from '../../campaign/campaign';
import { pristineCondition } from '../../campaign/repair';
import type { CampaignState, MechRecord } from '../../campaign/types';
import type { Design } from '../../schema/design';
import { catalog } from '../../../tests/support';
import { Hangar } from './Hangar';
import { MechBayPanel, MarketPanel } from './Panels';

function repairRecord(design: Design, id: string): MechRecord {
  const condition = pristineCondition(catalog, design);
  condition.left_arm.armour = Math.max(0, condition.left_arm.armour - 1);
  return {
    id,
    design: JSON.parse(JSON.stringify(design)) as Design,
    condition,
    status: 'ready',
    readyOnDay: 0,
    rebuildCost: 0,
  };
}

function mixedRepairState(): CampaignState {
  const state = startCampaign(catalog, 'border_dispute', 'faction-presentation');
  const linewrought = catalog.designs.get('bulwark_assault');
  const aurelian = catalog.designs.get('sentinel_brawler');
  if (linewrought === undefined || aurelian === undefined) {
    throw new Error('missing faction presentation fixtures');
  }
  state.mechs = [
    repairRecord(linewrought, 'linewrought-repair'),
    repairRecord(aurelian, 'aurelian-repair'),
  ];
  return state;
}

function expectedFactor(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

describe('campaign faction economy presentation', () => {
  it('identifies both workshop cultures and uses the authored repair factors', () => {
    const state = mixedRepairState();
    const mutate = () => undefined;
    const panel = renderToStaticMarkup(createElement(MechBayPanel, { state, mutate }));
    const hangar = renderToStaticMarkup(createElement(Hangar, {
      catalog,
      state,
      mutate,
      onRefit: () => undefined,
      onContinue: () => undefined,
      onCancel: () => undefined,
    }));
    const linewrought = catalog.rules.economy.repair.factionFactors.linewrought;
    const aurelian = catalog.rules.economy.repair.factionFactors.aurelian;

    for (const html of [panel, hangar]) {
      expect(html).toContain('Linewrought');
      expect(html).toContain('Aurelian Stock (Sealed)');
      expect(html).toContain(`${expectedFactor(linewrought.cost)}× workshop cost`);
      expect(html).toContain(`${expectedFactor(linewrought.days)}× workshop time`);
      expect(html).toContain(`${expectedFactor(aurelian.cost)}× workshop cost`);
      expect(html).toContain(`${expectedFactor(aurelian.days)}× workshop time`);
      expect(html).toContain('local repair supply');
      expect(html).toContain('replacement parts salvage-only');
    }
  });

  it('explains the Yard stock boundary from the authored faction allow-list', () => {
    const state = mixedRepairState();
    const html = renderToStaticMarkup(createElement(MarketPanel, {
      state,
      mutate: () => undefined,
    }));
    const available = catalog.rules.economy.market.availableFactions;

    expect(html).toContain('data-testid="yard-stock-note"');
    expect(html).toContain('Yard stock:');
    expect(html).toContain('machines only');
    if (!available.includes('aurelian')) {
      expect(html).toContain(
        'Aurelian Stock (Sealed) machines and replacement parts are salvage-only',
      );
    }
  });

  it('keeps the 300px Hiring Hall rail in one wrappable column', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(
      /\.camp-hall button\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(css).toMatch(
      /\.hall-terms\s*\{[^}]*grid-row:\s*auto;[^}]*grid-column:\s*1;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(css).toMatch(
      /\.faction-economy\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    );
  });
});
