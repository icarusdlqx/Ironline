import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import type { Campaign } from '../schema/campaign';

const campaign = catalog.campaigns.get('border_dispute');
if (campaign === undefined) throw new Error('missing Border Dispute campaign');

const VICTORY_LINE = [
  'militia_raid',
  'pass_skirmish',
  'foundry_sweep_node',
  'shale_overwatch_node',
  'ridge_hold',
];

function victoryNodes(data: Campaign): string[] {
  return [data.victoryNodeId, ...data.alternateVictoryNodeIds];
}

function openNodes(data: Campaign, completedIds: readonly string[]): string[] {
  const completed = new Set(completedIds);
  return data.nodes
    .filter(
      (node) =>
        !completed.has(node.id) && node.requires.every((required) => completed.has(required)),
    )
    .map((node) => node.id);
}

function enumerateVictoryRoutes(data: Campaign): string[][] {
  const routes: string[][] = [];
  const endings = new Set(victoryNodes(data));

  function visit(completed: Set<string>, route: string[]): void {
    for (const node of data.nodes) {
      if (completed.has(node.id)) continue;
      if (!node.requires.every((required) => completed.has(required))) continue;

      const nextRoute = [...route, node.id];
      if (endings.has(node.id)) {
        routes.push(nextRoute);
        continue;
      }

      const nextCompleted = new Set(completed);
      nextCompleted.add(node.id);
      visit(nextCompleted, nextRoute);
    }
  }

  visit(new Set(), []);
  return routes;
}

function mapIds(data: Campaign, route: readonly string[]): string[] {
  return route.map((nodeId) => {
    const node = data.nodes.find((entry) => entry.id === nodeId);
    const mission = node === undefined ? undefined : catalog.missions.get(node.missionId);
    if (mission === undefined) throw new Error(`missing mission for campaign node "${nodeId}"`);
    return mission.mapId;
  });
}

describe('Border Dispute route', () => {
  it('keeps every victory route on at least three distinct battlefields', () => {
    const routes = enumerateVictoryRoutes(campaign);
    const endings = victoryNodes(campaign);

    expect(routes.length).toBeGreaterThan(1);
    expect(new Set(routes.map((route) => route.at(-1)))).toEqual(new Set(endings));
    for (const route of routes) {
      expect(endings).toContain(route.at(-1));
      const positions = VICTORY_LINE.map((nodeId) => route.indexOf(nodeId));
      expect(
        positions.every(
          (position, index) =>
            position >= 0 && (index === 0 || position > (positions[index - 1] ?? -1)),
        ),
      ).toBe(true);
      expect(new Set(mapIds(campaign, route)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('offers Causeway as optional work without closing the Kestrel line', () => {
    const routes = enumerateVictoryRoutes(campaign);
    expect(routes.some((route) => route.includes('causeway_push'))).toBe(true);
    expect(routes.some((route) => !route.includes('causeway_push'))).toBe(true);

    expect(openNodes(campaign, ['militia_raid'])).toEqual(['pass_skirmish', 'supply_line']);
    expect(openNodes(campaign, ['militia_raid', 'supply_line', 'causeway_push'])).toContain(
      'pass_skirmish',
    );
    expect(openNodes(campaign, ['militia_raid', 'pass_skirmish'])).toEqual(
      expect.arrayContaining(['supply_line', 'foundry_sweep_node']),
    );
  });

  it('opens Foundry, Shale and Ridge in campaign order', () => {
    const throughPass = ['militia_raid', 'pass_skirmish'];
    expect(openNodes(campaign, throughPass)).toContain('foundry_sweep_node');
    expect(openNodes(campaign, [...throughPass, 'foundry_sweep_node'])).toContain(
      'shale_overwatch_node',
    );
    expect(
      openNodes(campaign, [...throughPass, 'foundry_sweep_node', 'shale_overwatch_node']),
    ).toEqual(expect.arrayContaining(['supply_line', 'ridge_hold']));

    expect(mapIds(campaign, ['causeway_push', 'foundry_sweep_node', 'shale_overwatch_node'])).toEqual(
      ['causeway', 'foundry_district', 'shale_steps'],
    );
  });
});
