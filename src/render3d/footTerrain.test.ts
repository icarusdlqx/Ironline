import { Mesh, Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { catalog, testWorld, unitOf } from '../../tests/support';
import type { BattleEffects } from './battleEffects';
import { Locomotion } from './locomotion';
import { createFootTerrainPose, sampleFootTerrain } from './footTerrain';
import { buildMechModel, disposeModel, type MechModel } from './mechModel';
import { buildTerrain } from './terrain';
import { createTerrainGrid } from '../sim/terrain';

const CENTRE = { x: 554, y: 742 };
const TRAVEL = 72;
const DT = 1 / 60;

function soleClearance(
  model: MechModel,
  heightAt: (x: number, y: number) => number,
): { minimum: number; leg: number } {
  const vertex = new Vector3();
  let minimum = Number.POSITIVE_INFINITY;
  let worstLeg = -1;
  model.root.updateMatrixWorld(true);
  for (let legIndex = 0; legIndex < model.legs.length; legIndex += 1) {
    const leg = model.legs[legIndex];
    if (leg === undefined) continue;
    for (const child of leg.ankle.children) {
      if (!(child instanceof Mesh) || child.geometry.type !== 'ExtrudeGeometry') continue;
      const positions = child.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
        const clearance = vertex.y - heightAt(vertex.x, vertex.z);
        if (clearance < minimum) {
          minimum = clearance;
          worstLeg = legIndex;
        }
      }
    }
  }
  return { minimum, leg: worstLeg };
}

describe('real-map foot terrain', () => {
  it.each([
    ['sentinel_brawler', 'uphill', 0],
    ['sentinel_brawler', 'downhill', Math.PI],
    ['sentinel_brawler', 'oblique', Math.PI / 2],
    ['hornet_spotter', 'uphill', 0],
    ['hornet_spotter', 'downhill', Math.PI],
    ['hornet_spotter', 'oblique', Math.PI / 2],
  ] as const)('keeps %s boots above Ridge terrain while walking %s', (designId, _label, turn) => {
    const data = catalog.maps.get('ridge_pass');
    expect(data).toBeDefined();
    if (data === undefined) return;
    const grid = createTerrainGrid(data, catalog.rules.terrain);
    const terrain = buildTerrain(grid, data);
    const span = 2;
    const gradeX = (terrain.heightAt(CENTRE.x + span, CENTRE.y)
      - terrain.heightAt(CENTRE.x - span, CENTRE.y)) / (span * 2);
    const gradeY = (terrain.heightAt(CENTRE.x, CENTRE.y + span)
      - terrain.heightAt(CENTRE.x, CENTRE.y - span)) / (span * 2);
    const heading = Math.atan2(gradeY, gradeX) + turn;
    const direction = { x: Math.cos(heading), y: Math.sin(heading) };
    const world = testWorld(`foot-terrain-${designId}-${turn}`);
    const entity = unitOf(world, designId);
    const chassis = catalog.chassis.get(entity.chassisId);
    expect(chassis).toBeDefined();
    if (chassis === undefined) return;
    const model = buildMechModel(
      chassis.silhouette,
      chassis.traits,
      entity.tonnage,
      0x78c9ff,
      false,
      [],
      new Set(),
      chassis.hardpoints,
      chassis.id,
    );
    const effects = { land: vi.fn(), plume: vi.fn() } as unknown as BattleEffects;
    const locomotion = new Locomotion(terrain.heightAt, () => 'rough', effects);
    const speed = entity.walkSpeed * 0.5;
    const frames = Math.ceil(TRAVEL / (speed * DT));
    let minimum = Number.POSITIVE_INFINITY;
    let minimumFrame = -1;
    let diagnostic = '';
    let maximumNormalError = 0;
    let exceedsHullTilt = false;
    const ankleAt = new Vector3();
    const ankleRotation = new Quaternion();
    const up = new Vector3();
    const plane = createFootTerrainPose();
    expect(Math.hypot(gradeX, gradeY)).toBeGreaterThan(0.5);
    for (let frame = 0; frame <= frames; frame += 1) {
      const distance = Math.min(TRAVEL, frame * speed * DT) - TRAVEL / 2;
      const at = {
        x: CENTRE.x + direction.x * distance,
        y: CENTRE.y + direction.y * distance,
        facing: heading,
        torso: 0,
      };
      const tile = grid.toTile(at);
      expect(grid.passable(tile.column, tile.row)).toBe(true);
      locomotion.place(entity, model, at, 0, DT);
      const clearance = soleClearance(model, terrain.heightAt);
      for (const leg of model.legs) {
        leg.ankle.getWorldPosition(ankleAt);
        sampleFootTerrain(
          plane, model.root, model.footprint,
          ankleAt.x, ankleAt.z, model.ankleClearance, terrain.heightAt,
        );
        up.set(0, 1, 0).applyQuaternion(leg.ankle.getWorldQuaternion(ankleRotation));
        maximumNormalError = Math.max(maximumNormalError, Math.hypot(
          up.x - plane.normalX,
          up.y - plane.normalY,
          up.z - plane.normalZ,
        ));
        exceedsHullTilt ||= Math.acos(up.y) > 0.4;
      }
      if (clearance.minimum < minimum) {
        minimum = clearance.minimum;
        minimumFrame = frame;
        const ankle = model.legs[clearance.leg]?.ankle;
        if (ankle !== undefined) {
          const ankleAt = ankle.getWorldPosition(new Vector3());
          const plane = createFootTerrainPose();
          sampleFootTerrain(
            plane, model.root, model.footprint,
            ankleAt.x, ankleAt.z, model.ankleClearance, terrain.heightAt,
          );
          const up = new Vector3(0, 1, 0).applyQuaternion(
            ankle.getWorldQuaternion(new Quaternion()),
          );
          diagnostic = `leg ${clearance.leg}, joint ${ankleAt.y.toFixed(3)}/${plane.targetY.toFixed(3)}, up ${up.x.toFixed(3)},${up.y.toFixed(3)},${up.z.toFixed(3)}`;
        }
      }
    }

    expect(minimum, `worst frame ${minimumFrame} of ${frames}; ${diagnostic}`)
      .toBeGreaterThanOrEqual(-0.15);
    expect(maximumNormalError).toBeLessThan(0.00001);
    expect(exceedsHullTilt).toBe(true);
    disposeModel(model.root);
    terrain.mesh.geometry.dispose();
    if (Array.isArray(terrain.mesh.material)) {
      terrain.mesh.material.forEach((material) => material.dispose());
    } else {
      terrain.mesh.material.dispose();
    }
  });
});
