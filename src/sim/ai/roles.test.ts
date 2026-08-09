import { describe, expect, it } from 'vitest';
import { catalog, spawnDesign, testWorld } from '../../../tests/support';
import { COMBAT_ROLES, lanceFrontage, roleOf, type CombatRole } from './roles';

const world = testWorld('roles');

/** The role every stock design classifies as, in one pass. */
const assigned = new Map<string, CombatRole>(
  [...catalog.designs.keys()].map((designId) => [
    designId,
    roleOf(world, spawnDesign(world, designId)).role,
  ]),
);

describe('combat roles', () => {
  it('reads its thresholds and profiles from the rules, not from code', () => {
    const rules = catalog.rules.ai.roles;
    expect(Object.keys(rules.profiles).sort()).toEqual([...COMBAT_ROLES].sort());
    for (const role of COMBAT_ROLES) {
      expect(rules.profiles[role].aggression).toBeGreaterThan(0);
    }
  });

  it('reaches every role from the stock designs', () => {
    // Two roles used to be unreachable, so the profiles for them were dead
    // weight the AI never read. A data change that strands one again should
    // fail here rather than quietly narrowing how the enemy fights.
    const used = new Set(assigned.values());
    const missing = COMBAT_ROLES.filter((role) => !used.has(role));
    expect(missing, `no stock design classifies as: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('sends the brawlers forward and holds the missile boats back', () => {
    const order: CombatRole[] = ['brawler', 'skirmisher', 'scout', 'sniper', 'missile_boat'];
    const standoffs = order.map((role) => catalog.rules.ai.roles.profiles[role].standoff);
    expect([...standoffs].sort((a, b) => a - b)).toEqual(standoffs);
  });

  it('classifies a light hull as a scout rather than something to brawl with', () => {
    expect(assigned.get('wisp_scout')).toBe('scout');
    expect(assigned.get('hornet_striker')).toBe('scout');
  });

  it('classifies a heavy short-range hull as a brawler', () => {
    expect(assigned.get('colossus_hammer')).toBe('brawler');
    expect(assigned.get('sentinel_brawler')).toBe('brawler');
  });

  it('separates the direct-fire long guns from the indirect ones', () => {
    // LRMs are both long-ranged and indirect, so whichever test runs first
    // claims them. The long guns go first, and only what is left is artillery.
    expect(assigned.get('colossus_siege')).toBe('sniper');
    expect(assigned.get('warden_picket')).toBe('missile_boat');
  });

  it('measures the frontage over the rest of the lance, not the mech itself', () => {
    const line = testWorld('frontage');
    const target = spawnDesign(line, 'rampart_breaker', 1, { x: 600, y: 300 });
    const front = spawnDesign(line, 'colossus_hammer', 0, { x: 300, y: 300 });
    const back = spawnDesign(line, 'warden_picket', 0, { x: 100, y: 300 });
    for (const other of line.entities) {
      if (other !== target && other !== front && other !== back) other.destroyed = true;
    }

    // Counting itself made the frontage the mech's own range, so whoever was
    // already in front was told to stand its standoff closer than wherever it
    // was — a pull with no fixed point, every decision, for ever.
    expect(lanceFrontage(line, front, target)).toBeCloseTo(500, 3);
    expect(lanceFrontage(line, back, target)).toBeCloseTo(300, 3);
  });

  it('treats a disarmed mech as a spotter', () => {
    const mech = spawnDesign(world, 'colossus_hammer');
    for (const mount of mech.weapons) mount.destroyed = true;
    expect(roleOf(world, mech).role).toBe('scout');
  });
});
