import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../tests/support';
import { startCampaign } from '../../campaign/campaign';
import { startRepair } from '../../campaign/repair';
import { Hangar } from './Hangar';
import { MarketPanel, MechBayPanel } from './Panels';

function queuedState() {
  const state = startCampaign(catalog, 'border_dispute', 'visible-repair-queue');
  const [active, queued] = state.mechs;
  if (active === undefined || queued === undefined) throw new Error('campaign needs two machines');
  active.condition.centre_torso.armour -= 1;
  queued.condition.centre_torso.armour -= 1;
  if (!startRepair(catalog, state, active).ok || !startRepair(catalog, state, queued).ok) {
    throw new Error('could not book repair fixtures');
  }
  return { state, active, queued };
}

describe('repair queue readouts', () => {
  it('names the active lift, the waiting place and both ready dates', () => {
    const { state, active, queued } = queuedState();
    const props = { state, mutate: () => undefined };
    const bay = renderToStaticMarkup(createElement(MechBayPanel, props));

    expect(bay).toContain('One lift works through the queue in order');
    expect(bay).toContain(`on a lift · ready day ${active.readyOnDay}`);
    expect(bay).toContain(`queued 1 · starts day ${active.readyOnDay}`);
    expect(bay).toContain(`ready day ${queued.readyOnDay}`);

    const hangar = renderToStaticMarkup(
      createElement(Hangar, {
        catalog,
        state,
        mutate: () => undefined,
        onRefit: () => undefined,
        onContinue: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(hangar).toContain(`On a lift — ready day ${active.readyOnDay}`);
    expect(hangar).toContain(`Queued 1 — starts day ${active.readyOnDay}`);
  });

  it('explains why a paid workshop booking cannot be sold', () => {
    const { state, active } = queuedState();
    const market = renderToStaticMarkup(
      createElement(MarketPanel, { state, mutate: () => undefined }),
    );

    expect(market).toContain(`data-testid="market-sell-${active.id}"`);
    expect(market).toContain(`paid workshop booking · ready day ${active.readyOnDay}`);
    expect(market).toContain('This paid workshop booking must finish before sale');
  });

  it('labels an overlapping old promise without claiming a zero-day queue slot', () => {
    const state = startCampaign(catalog, 'border_dispute', 'inherited-repair-booking');
    const [first, inherited] = state.mechs;
    if (first === undefined || inherited === undefined) throw new Error('campaign needs two machines');
    first.status = 'repairing';
    inherited.status = 'repairing';
    first.readyOnDay = state.day + 2;
    inherited.readyOnDay = state.day + 2;

    const bay = renderToStaticMarkup(
      createElement(MechBayPanel, { state, mutate: () => undefined }),
    );
    expect(bay).toContain(`inherited concurrent booking · ready day ${inherited.readyOnDay}`);
    expect(bay).not.toContain(
      `starts day ${inherited.readyOnDay} · ready day ${inherited.readyOnDay}`,
    );

    const hangar = renderToStaticMarkup(
      createElement(Hangar, {
        catalog,
        state,
        mutate: () => undefined,
        onRefit: () => undefined,
        onContinue: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(hangar).toContain(
      `Inherited concurrent booking — ready day ${inherited.readyOnDay}`,
    );
  });
});
