import { describe, expect, it } from 'vitest';
import { catalog } from './support';
import { radiusFor } from '../src/render/shape';

/**
 * The simulation keeps mechs from standing inside one another using a radius
 * read from the movement rules; the renderer draws a hull at a radius of its
 * own. They describe the same thing. Let them drift apart and mechs visibly
 * overlap while the simulation is convinced they are clear of each other, or
 * they stop a stride short of contact for no reason a player can see.
 *
 * This lives outside /sim because /sim is not allowed to see the renderer.
 */
describe('body radius', () => {
  it('is the same number in the rules and in the renderer', () => {
    const rules = catalog.rules.movement;
    for (const tonnage of [20, 25, 35, 45, 60, 70, 85, 100]) {
      expect(
        rules.bodyRadiusBase + tonnage * rules.bodyRadiusPerTon,
        `${tonnage} tonnes`,
      ).toBeCloseTo(radiusFor(tonnage), 6);
    }
  });
});
