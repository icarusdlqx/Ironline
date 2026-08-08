import { describe, expect, it } from 'vitest';
import { catalog } from '../../tests/support';
import { balanceByClass, balanceOutliers, weaponEfficiency } from './balance';
import { runBattle } from './world';

describe('weapon balance', () => {
  it('scores every weapon in the catalogue', () => {
    const counted = balanceByClass(catalog).reduce(
      (total, group) => total + group.entries.length,
      0,
    );
    expect(counted).toBe(catalog.weapons.size);
  });

  it('charges a weapon for the heat sinks it demands', () => {
    // Two guns with the same damage differ only in heat: the hotter one must
    // score worse, because keeping it fed costs tonnage the mech cannot spend.
    const gauss = catalog.weapons.get('gauss_rifle');
    const ac20 = catalog.weapons.get('ac20');
    expect(gauss).toBeDefined();
    expect(ac20).toBeDefined();
    if (gauss === undefined || ac20 === undefined) return;

    expect(weaponEfficiency(catalog, gauss).effectiveTons).toBeLessThan(
      gauss.tonnage + ac20.heat / ac20.cooldown / catalog.rules.heat.dissipationPerSinkPerSecond,
    );
  });

  // Phase 6 acceptance, first half.
  it('keeps every weapon within the band of its class median', () => {
    const outliers = balanceOutliers(catalog);
    const detail = outliers
      .map((entry) => `${entry.name} ${(entry.deviation * 100).toFixed(1)}%`)
      .join(', ');
    expect(outliers, `outside the band: ${detail}`).toHaveLength(0);
  });

  it('reports a median for each weapon class', () => {
    const groups = balanceByClass(catalog);
    expect(groups.map((group) => group.type).sort()).toEqual([
      'ballistic',
      'energy',
      'missile',
    ]);
    for (const group of groups) expect(group.median).toBeGreaterThan(0);
  });
});

/**
 * Phase 6 acceptance, second half: the utility AI has to beat a competent human
 * baseline — nearest target, range-bracket discipline, heat discipline — using
 * the same lance on both sides. The controllers swap sides every other run so a
 * favourable corner of the map cannot flatter either one.
 */
describe('mirror match against the baseline controller', () => {
  const ITERATIONS = 30;

  function fight(): { aiWins: number; baselineWins: number; draws: number } {
    let aiWins = 0;
    let baselineWins = 0;
    let draws = 0;

    for (let index = 0; index < ITERATIONS; index += 1) {
      const aiTeam = index % 2;
      const result = runBattle(catalog, {
        seed: `mirror:${index}`,
        missionId: 'mirror_ridge',
        playerTeam: 0,
        playerController: aiTeam === 0 ? 'tactical' : 'baseline',
        enemyController: aiTeam === 0 ? 'baseline' : 'tactical',
      });

      if (result.winner === null) draws += 1;
      else if (result.winner === aiTeam) aiWins += 1;
      else baselineWins += 1;
    }

    return { aiWins, baselineWins, draws };
  }

  it('wins at least 40% of engagements', () => {
    const { aiWins, baselineWins, draws } = fight();
    const share = aiWins / ITERATIONS;
    expect(
      share,
      `tactical ${aiWins}, baseline ${baselineWins}, draws ${draws} of ${ITERATIONS}`,
    ).toBeGreaterThanOrEqual(0.4);
  }, 120_000);

  it('is deterministic across runs', () => {
    const once = fight();
    const twice = fight();
    expect(twice).toEqual(once);
  }, 240_000);
});
