import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { TacticalCamera } from '../render3d/camera';
import type { Deployment, Mission } from './mission';
import { findPath } from '../sim/pathfind';
import { createTerrainGrid } from '../sim/terrain';
import { createWorld, runBattle, stepWorld } from '../sim/world';
import { arrowPanDelta } from '../ui/cameraNavigation';

const LARGE_MISSIONS = ['exchange_register', 'quarry_brakes'] as const;

function mission(id: (typeof LARGE_MISSIONS)[number]): Mission {
  const found = catalog.missions.get(id);
  if (found === undefined) throw new Error(`missing large mission "${id}"`);
  return found;
}

function deployments(data: Mission): Deployment[] {
  const initial = data.lances.flatMap((lance) => lance.units);
  const delayed = data.triggers.flatMap((trigger) =>
    trigger.effects.flatMap((effect) => (effect.type === 'spawn' ? effect.units : [])),
  );
  return [...initial, ...data.reserves, ...delayed];
}

describe('large battlefield traversal', () => {
  it('admits the Cutbank relief before its clear objective can settle', () => {
    const world = createWorld(catalog, {
      seed: 'large-field:exchange-register:relief-order',
      missionId: 'exchange_register',
      playerTeam: 0,
    });

    stepWorld(world, catalog.rules.simulation.maxBattleTicks);
    const relief = world.entities.find((entity) => entity.pilot.id === 'tomas_arvel');
    expect(relief?.designId).toBe('rampart_breaker');
    expect(world.objectives.find((objective) => objective.id === 'clear_exchange')?.status).toBe(
      'active',
    );

    for (const entity of world.entities) {
      if (entity.team === 1 && entity !== relief) entity.destroyed = true;
    }
    stepWorld(world, catalog.rules.simulation.maxBattleTicks);
    expect(world.objectives.find((objective) => objective.id === 'clear_exchange')?.status).toBe(
      'active',
    );
  });

  it.each(LARGE_MISSIONS)('%s keeps every authored route inside the real node budget', (id) => {
    const data = mission(id);
    const map = catalog.maps.get(data.mapId);
    if (map === undefined) throw new Error(`missing map "${data.mapId}"`);
    const grid = createTerrainGrid(map, catalog.rules.terrain);
    const maxNodes = catalog.rules.simulation.pathfindMaxNodes;
    const extentX = map.width * map.tileSize;
    const extentY = map.height * map.tileSize;

    for (const zone of data.zones) {
      expect(zone.x - zone.radius, `${id}/${zone.id} crosses the west edge`).toBeGreaterThanOrEqual(0);
      expect(zone.y - zone.radius, `${id}/${zone.id} crosses the north edge`).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.radius, `${id}/${zone.id} crosses the east edge`).toBeLessThanOrEqual(extentX);
      expect(zone.y + zone.radius, `${id}/${zone.id} crosses the south edge`).toBeLessThanOrEqual(extentY);

      for (const unit of deployments(data)) {
        const route = findPath(grid, unit.spawn, { x: zone.x, y: zone.y }, maxNodes);
        expect(route, `${id}/${unit.pilotId} cannot reach ${zone.id}`).not.toBeNull();
        expect(route?.at(-1), `${id}/${unit.pilotId} stops short of ${zone.id}`).toEqual({
          x: zone.x,
          y: zone.y,
        });
      }
    }
  });

  it.each(LARGE_MISSIONS)('%s finishes repeatable tactical runs without wedging', { timeout: 60_000 }, (id) => {
    const results = Array.from({ length: 10 }, (_, index) =>
      runBattle(catalog, {
        seed: `large-field:${id}:${index}`,
        missionId: id,
        playerTeam: 0,
        playerController: 'tactical',
        enemyController: 'tactical',
      }),
    );

    for (const [index, result] of results.entries()) {
      expect(result.decided, `${id} seed ${index} exhausted the global clock`).toBe(true);
      expect(result.missionStatus, `${id} seed ${index} stayed active`).not.toBe('active');
      expect(
        result.units.reduce((total, unit) => total + unit.shotsFired, 0),
        `${id} seed ${index} never exchanged fire`,
      ).toBeGreaterThan(0);
    }
    expect(
      results.filter((result) => result.missionStatus === 'success').length,
      `${id} is not reliably winnable by the tactical reference lance`,
    ).toBeGreaterThanOrEqual(8);

    const replay = runBattle(catalog, {
      seed: `large-field:${id}:0`,
      missionId: id,
      playerTeam: 0,
      playerController: 'tactical',
      enemyController: 'tactical',
    });
    expect(replay).toEqual(results[0]);
  });

  it.each(LARGE_MISSIONS)('%s preserves arrow direction and clamps at the larger bounds', (id) => {
    const data = mission(id);
    const map = catalog.maps.get(data.mapId);
    if (map === undefined) throw new Error(`missing map "${data.mapId}"`);
    const width = map.width * map.tileSize;
    const height = map.height * map.tileSize;
    const centre = { x: width / 2, y: height / 2 };

    const shifted = (key: string) => {
      const camera = new TacticalCamera(true);
      camera.setBounds(width, height);
      camera.centreOn(centre);
      const delta = arrowPanDelta(new Set([key]), 24);
      camera.panBy(delta.x, delta.y);
      return camera.target;
    };

    expect(shifted('ArrowLeft').x).toBeGreaterThan(centre.x);
    expect(shifted('ArrowRight').x).toBeLessThan(centre.x);
    expect(shifted('ArrowUp').y).toBeGreaterThan(centre.y);
    expect(shifted('ArrowDown').y).toBeLessThan(centre.y);

    const bounded = new TacticalCamera(true);
    bounded.setBounds(width, height);
    bounded.centreOn(centre);
    bounded.panBy(-100_000, -100_000);
    expect(bounded.target.x).toBeGreaterThan(0);
    expect(bounded.target.y).toBeGreaterThan(0);
    bounded.panBy(200_000, 200_000);
    expect(bounded.target.x).toBeLessThan(width);
    expect(bounded.target.y).toBeLessThan(height);
  });
});
