import type { Catalog } from '../schema/load';
import type { BattleResult, UnitResult } from '../sim/world';

export interface DesignAggregate {
  designId: string;
  name: string;
  sorties: number;
  survived: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  heatPeak: number;
}

export interface WeaponAggregate {
  weaponId: string;
  shots: number;
  hits: number;
  damage: number;
  heat: number;
}

export interface Aggregate {
  iterations: number;
  teamWins: Map<number, number>;
  draws: number;
  undecided: number;
  durations: number[];
  designs: Map<string, DesignAggregate>;
  killMethods: Map<string, number>;
  weapons: Map<string, WeaponAggregate>;
}

function accumulateUnit(aggregate: Aggregate, unit: UnitResult): void {
  const entry = aggregate.designs.get(unit.designId) ?? {
    designId: unit.designId,
    name: unit.name,
    sorties: 0,
    survived: 0,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    heatPeak: 0,
  };

  entry.sorties += 1;
  if (unit.alive) entry.survived += 1;
  entry.kills += unit.kills;
  entry.damageDealt += unit.damageDealt;
  entry.damageTaken += unit.damageTaken;
  entry.shotsFired += unit.shotsFired;
  entry.shotsHit += unit.shotsHit;
  entry.heatPeak = Math.max(entry.heatPeak, unit.heatPeak);
  aggregate.designs.set(unit.designId, entry);

  if (unit.killMethod !== null) {
    aggregate.killMethods.set(
      unit.killMethod,
      (aggregate.killMethods.get(unit.killMethod) ?? 0) + 1,
    );
  }
}

export function aggregate(results: readonly BattleResult[]): Aggregate {
  const summary: Aggregate = {
    iterations: results.length,
    teamWins: new Map(),
    draws: 0,
    undecided: 0,
    durations: [],
    designs: new Map(),
    killMethods: new Map(),
    weapons: new Map(),
  };

  for (const result of results) {
    if (result.winner === null) summary.draws += 1;
    else summary.teamWins.set(result.winner, (summary.teamWins.get(result.winner) ?? 0) + 1);
    if (!result.decided) summary.undecided += 1;

    summary.durations.push(result.durationSeconds);

    for (const unit of result.units) accumulateUnit(summary, unit);

    for (const weapon of result.weapons) {
      const entry = summary.weapons.get(weapon.weaponId) ?? {
        weaponId: weapon.weaponId,
        shots: 0,
        hits: 0,
        damage: 0,
        heat: 0,
      };
      entry.shots += weapon.shots;
      entry.hits += weapon.hits;
      entry.damage += weapon.damage;
      entry.heat += weapon.heat;
      summary.weapons.set(weapon.weaponId, entry);
    }
  }

  return summary;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

type Row = readonly string[];

function renderTable(headers: Row, rows: readonly Row[]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );

  const line = (row: Row): string =>
    row
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column] ?? 0)
          : cell.padStart(widths[column] ?? 0),
      )
      .join('  ');

  const divider = widths.map((width) => '─'.repeat(width)).join('  ');
  return [line(headers), divider, ...rows.map(line)].join('\n');
}

const percent = (value: number, total: number): string =>
  total === 0 ? '—' : `${((value / total) * 100).toFixed(1)}%`;

export function formatReport(summary: Aggregate, catalog: Catalog): string {
  const sections: string[] = [];

  const teams = [...summary.teamWins.keys()].sort((a, b) => a - b);
  const outcomeRows: Row[] = teams.map((team) => [
    `Team ${team}`,
    String(summary.teamWins.get(team) ?? 0),
    percent(summary.teamWins.get(team) ?? 0, summary.iterations),
  ]);
  outcomeRows.push(['Draw', String(summary.draws), percent(summary.draws, summary.iterations)]);

  sections.push(renderTable(['Outcome', 'Battles', 'Share'], outcomeRows));

  sections.push(
    [
      `battles           ${summary.iterations}`,
      `mean duration     ${mean(summary.durations).toFixed(1)}s`,
      `median duration   ${median(summary.durations).toFixed(1)}s`,
      `hit time limit    ${summary.undecided}`,
    ].join('\n'),
  );

  const designRows: Row[] = [...summary.designs.values()]
    .sort((a, b) => a.designId.localeCompare(b.designId))
    .map((design) => [
      design.name,
      String(design.sorties),
      percent(design.survived, design.sorties),
      (design.kills / design.sorties).toFixed(2),
      (design.damageDealt / design.sorties).toFixed(0),
      (design.damageTaken / design.sorties).toFixed(0),
      percent(design.shotsHit, design.shotsFired),
      design.heatPeak.toFixed(0),
    ]);

  sections.push(
    renderTable(
      ['Design', 'Sorties', 'Survived', 'Kills', 'Dealt', 'Taken', 'Accuracy', 'PeakHeat'],
      designRows,
    ),
  );

  const killRows: Row[] = [...summary.killMethods.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => [
      method,
      String(count),
      percent(count, [...summary.killMethods.values()].reduce((sum, value) => sum + value, 0)),
    ]);
  if (killRows.length > 0) {
    sections.push(renderTable(['Kill method', 'Count', 'Share'], killRows));
  }

  const weaponRows: Row[] = [...summary.weapons.values()]
    .sort((a, b) => a.weaponId.localeCompare(b.weaponId))
    .map((entry) => {
      const weapon = catalog.weapons.get(entry.weaponId);
      const perTon = weapon === undefined ? 0 : entry.damage / entry.shots / weapon.tonnage;
      const perHeat =
        weapon === undefined || weapon.heat === 0
          ? Number.POSITIVE_INFINITY
          : entry.damage / entry.shots / weapon.heat;
      return [
        weapon?.name ?? entry.weaponId,
        String(entry.shots),
        percent(entry.hits, entry.shots),
        entry.damage.toFixed(0),
        (entry.damage / Math.max(1, entry.shots)).toFixed(2),
        perTon.toFixed(3),
        Number.isFinite(perHeat) ? perHeat.toFixed(3) : '∞',
      ];
    });

  sections.push(
    renderTable(
      ['Weapon', 'Shots', 'Accuracy', 'Damage', 'Dmg/shot', 'Dmg/ton', 'Dmg/heat'],
      weaponRows,
    ),
  );

  return sections.join('\n\n');
}
