import type { BattleResult, UnitResult } from '../sim/world';

export type ResultTone = 'victory' | 'defeat' | 'timeout' | 'draw';

export interface LanceResultRow {
  id: number;
  name: string;
  status: 'Operational' | 'Withdrew' | 'Ejected' | 'Lost';
  pilotLost: boolean;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  accuracy: number | null;
  locationsLost: number;
}

export interface BattleResultView {
  tone: ResultTone;
  headline: string;
  reason: string;
  duration: string;
  operational: number;
  lanceSize: number;
  hostilesStopped: number;
  hostileCount: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  shotsFired: number;
  shotsHit: number;
  accuracy: number | null;
  lance: LanceResultRow[];
}

export function formatBattleDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const closed = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${closed[0]?.toUpperCase() ?? ''}${closed.slice(1)}`;
}

function toneFor(result: BattleResult, playerTeam: number): ResultTone {
  if (result.missionStatus === 'success') return 'victory';
  if (result.missionStatus === 'failure') {
    return result.missionReason === 'the mission clock ran out' ? 'timeout' : 'defeat';
  }
  if (!result.decided) return 'timeout';
  if (result.winner === playerTeam) return 'victory';
  if (result.winner === null) return 'draw';
  return 'defeat';
}

function reasonFor(result: BattleResult, playerTeam: number): string {
  if (result.missionReason !== null) return sentence(result.missionReason);
  if (!result.decided) {
    if (result.winner === playerTeam) {
      return 'Time expired with the lance ahead on operational units.';
    }
    if (result.winner === null) return 'Time expired with the surviving forces level.';
    return 'Time expired with the opposing force ahead on operational units.';
  }
  if (result.winner === playerTeam) return 'The opposing force was put out of action.';
  if (result.winner === null) return 'Neither side kept an operational unit.';
  return 'The lance was put out of action.';
}

function statusFor(unit: UnitResult): LanceResultRow['status'] {
  if (unit.withdrew) return 'Withdrew';
  if (unit.pilotEjected) return 'Ejected';
  if (unit.alive) return 'Operational';
  return 'Lost';
}

function round(value: number): number {
  return Math.round(value);
}

function sum(units: readonly UnitResult[], read: (unit: UnitResult) => number): number {
  return round(units.reduce((total, unit) => total + read(unit), 0));
}

function accuracy(hits: number, shots: number): number | null {
  return shots === 0 ? null : Math.round((hits / shots) * 100);
}

export function viewBattleResult(result: BattleResult, playerTeam: number): BattleResultView {
  const player = result.units.filter((unit) => unit.team === playerTeam);
  const hostiles = result.units.filter((unit) => unit.team !== playerTeam);
  const shotsFired = sum(player, (unit) => unit.shotsFired);
  const shotsHit = sum(player, (unit) => unit.shotsHit);
  const tone = toneFor(result, playerTeam);

  return {
    tone,
    headline:
      tone === 'victory'
        ? 'Victory'
        : tone === 'defeat'
          ? 'Defeat'
          : tone === 'timeout'
            ? 'Time expired'
            : 'Draw',
    reason: reasonFor(result, playerTeam),
    duration: formatBattleDuration(result.durationSeconds),
    operational: player.filter((unit) => statusFor(unit) === 'Operational').length,
    lanceSize: player.length,
    hostilesStopped: hostiles.filter((unit) => statusFor(unit) !== 'Operational').length,
    hostileCount: hostiles.length,
    kills: sum(player, (unit) => unit.kills),
    damageDealt: sum(player, (unit) => unit.damageDealt),
    damageTaken: sum(player, (unit) => unit.damageTaken),
    shotsFired,
    shotsHit,
    accuracy: accuracy(shotsHit, shotsFired),
    lance: player.map((unit) => ({
      id: unit.id,
      name: unit.name,
      status: statusFor(unit),
      pilotLost: unit.pilotDead,
      kills: round(unit.kills),
      damageDealt: round(unit.damageDealt),
      damageTaken: round(unit.damageTaken),
      shotsFired: round(unit.shotsFired),
      shotsHit: round(unit.shotsHit),
      accuracy: accuracy(unit.shotsHit, unit.shotsFired),
      locationsLost: Object.values(unit.condition).filter((location) => location.destroyed).length,
    })),
  };
}
