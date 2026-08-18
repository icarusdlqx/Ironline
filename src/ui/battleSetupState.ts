import type { DifficultyRules, DifficultyTier } from '../schema/rules';

export interface BattleSetupKey {
  missionId: string;
  difficulty: string;
  lanceKey: string;
}

export interface DifficultyChoice {
  id: string;
  label: string;
  description: string;
}

export function engineSetupFor(
  draft: BattleSetupKey,
  deployed: BattleSetupKey | null,
): BattleSetupKey {
  return deployed ?? draft;
}

export function isBattleSetupLocked(
  briefingSeen: boolean,
  finished: boolean,
  campaignPending: boolean,
): boolean {
  return briefingSeen && (!finished || campaignPending);
}

function titleCase(id: string): string {
  return id
    .split('_')
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}

function joinTactics(tactics: string[]): string {
  if (tactics.length === 0) return 'They fight independently without coordinated tactics.';
  if (tactics.length === 1) return `They ${tactics[0]}.`;
  if (tactics.length === 2) return `They ${tactics[0]} and ${tactics[1]}.`;
  return `They ${tactics.slice(0, -1).join(', ')}, and ${tactics.at(-1)}.`;
}

export function describeDifficulty(tier: DifficultyTier): string {
  const skill =
    tier.skillDelta < 0
      ? 'Enemy pilots are less accurate'
      : tier.skillDelta === 0
        ? 'Enemy pilots shoot at normal accuracy'
        : tier.skillDelta === 1
          ? 'Enemy pilots are more accurate'
          : 'Enemy pilots are highly accurate';
  const pressure =
    tier.aggression < 1
      ? 'advance cautiously'
      : tier.aggression === 1
        ? 'keep a measured pace'
        : 'press attacks';
  const tactics = [
    tier.focusFire ? 'focus damaged targets' : null,
    tier.coverSeeking ? 'seek cover' : null,
    tier.flanking ? 'flank exposed mechs' : null,
    tier.calledShots ? 'aim at vulnerable sections' : null,
  ].filter((entry): entry is string => entry !== null);

  return `${skill} and ${pressure}. ${joinTactics(tactics)}`;
}

export function difficultyChoices(rules: DifficultyRules): DifficultyChoice[] {
  return Object.entries(rules.tiers).map(([id, tier]) => ({
    id,
    label: titleCase(id),
    description: describeDifficulty(tier),
  }));
}
